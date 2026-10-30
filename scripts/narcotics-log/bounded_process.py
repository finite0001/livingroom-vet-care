"""Lossless, byte-bounded subprocess transport for owned local rehearsals.

Metadata, physical-boundary and HTTP limits are separate contracts. This
module bounds the metadata/process channel; it never truncates into success.
"""
import math
import os
import selectors
import signal
import subprocess
import time

SOURCE_CAP = 64 * 1024 * 1024
STDOUT_CAP = 64 * 1024 * 1024
STDERR_CAP = 2 * 1024 * 1024


class ProcessOutputLimit(RuntimeError):
    def __init__(self, channel, stdout, stderr):
        super().__init__("Owned process exceeded its " + channel + " byte contract")
        self.stdout, self.stderr = bytes(stdout), bytes(stderr)


class ProcessInputIncomplete(RuntimeError):
    pass


class ProcessEncodingError(RuntimeError):
    def __init__(self, stdout, stderr):
        super().__init__("Owned process returned invalid UTF-8")
        self.stdout, self.stderr = bytes(stdout), bytes(stderr)


def run(argv, *, input=None, env=None, capture_output=True, text=True,
        cwd=None, timeout, check=False, stdout_cap=STDOUT_CAP,
        stderr_cap=STDERR_CAP, _cleanup_fallback=True):
    if not isinstance(argv, (list, tuple)) or not argv or any(type(x) is not str or "\0" in x for x in argv):
        raise ValueError("Explicit argument array required")
    if capture_output is not True or text is not True or type(check) is not bool or type(_cleanup_fallback) is not bool:
        raise ValueError("Only the declared captured UTF-8 process contract is supported")
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 600:
        raise ValueError("Finite original-deadline timeout required")
    if any(type(cap) is not int or not 0 <= cap <= SOURCE_CAP for cap in (stdout_cap, stderr_cap)):
        raise ValueError("Explicit bounded channel sizes required")
    if input is not None and type(input) is not str:
        raise ValueError("UTF-8 process input required")
    incoming = b"" if input is None else input.encode("utf-8", errors="strict")
    if len(incoming) > SOURCE_CAP:
        raise ValueError("Process input exceeds its separate source byte contract")
    deadline = time.monotonic() + timeout
    output = {"stdout": bytearray(), "stderr": bytearray()}
    limits = {"stdout": stdout_cap, "stderr": stderr_cap}
    process = subprocess.Popen(
        argv, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd, env=env,
        start_new_session=True, close_fds=True,
    )
    written = 0
    try:
        with selectors.DefaultSelector() as selector:
            for name in ("stdout", "stderr"):
                pipe = getattr(process, name)
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            if process.stdin is not None:
                if incoming:
                    os.set_blocking(process.stdin.fileno(), False)
                    selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
                else:
                    process.stdin.close()
            while selector.get_map() or process.poll() is None:
                left = deadline - time.monotonic()
                if left <= 0:
                    raise subprocess.TimeoutExpired(argv, timeout,
                                                    output=bytes(output["stdout"]),
                                                    stderr=bytes(output["stderr"]))
                for key, _ in selector.select(min(left, 0.05)):
                    pipe, name = key.fileobj, key.data
                    if name == "stdin":
                        try:
                            size = os.write(pipe.fileno(), memoryview(incoming)[written:written + 65536])
                        except BlockingIOError:
                            continue
                        except BrokenPipeError as error:
                            raise ProcessInputIncomplete("Owned process closed before consuming its complete input") from error
                        written += size
                        if written == len(incoming):
                            selector.unregister(pipe)
                            pipe.close()
                        continue
                    try:
                        chunk = os.read(pipe.fileno(), min(65536, limits[name] - len(output[name]) + 1))
                    except BlockingIOError:
                        continue
                    if not chunk:
                        selector.unregister(pipe)
                        pipe.close()
                        continue
                    output[name].extend(chunk)
                    if len(output[name]) > limits[name]:
                        raise ProcessOutputLimit(name, output["stdout"], output["stderr"])
            if written != len(incoming):
                raise ProcessInputIncomplete("Complete process input was not sent")
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(argv, timeout, output=bytes(output["stdout"]),
                                                stderr=bytes(output["stderr"]))
        try:
            stdout = bytes(output["stdout"]).decode("utf-8", errors="strict")
            stderr = bytes(output["stderr"]).decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ProcessEncodingError(output["stdout"], output["stderr"]) from error
        result = subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
        if check:
            result.check_returncode()
        return result
    finally:
        # Every child starts in its own session. Never signal another task's
        # process or any resource discovered through a name-only search.
        # Do not reap the leader before signaling its group: an exited leader
        # may have a still-running child holding the output pipes. Keeping its
        # PID reserved also prevents signaling an unrelated reused PID.
        try:
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    # Some hosts refuse a signal after all group members have
                    # exited. Accept that case only after reaping our leader
                    # and independently observing no live group member. The
                    # read-only probe cannot recurse into another fallback.
                    if not _cleanup_fallback or process.poll() is None:
                        raise
                    groups = run(["/bin/ps", "-axo", "pgid=,stat="], timeout=2,
                                 stdout_cap=1024 * 1024, stderr_cap=65536,
                                 check=True, _cleanup_fallback=False).stdout
                    for line in groups.splitlines():
                        fields = line.split()
                        if len(fields) != 2 or not fields[0].isdigit():
                            raise RuntimeError("Unrecognized process-group observation")
                        if int(fields[0]) == process.pid and not fields[1].startswith("Z"):
                            raise RuntimeError("Owned process group still has a live member")
                process.wait(timeout=2)
        finally:
            for pipe in (process.stdin, process.stdout, process.stderr):
                if pipe is not None and not pipe.closed:
                    pipe.close()
