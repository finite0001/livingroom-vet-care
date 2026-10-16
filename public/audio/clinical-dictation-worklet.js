/* PCM capture only. Audio never enters browser persistence. */
class ClinicalDictationProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.paused=false; this.active=true; this.total=0; this.used=0; this.buffer=new Int16Array(2048);
    this.port.onmessage=event=>{
      if(event.data==="pause")this.paused=true;
      if(event.data==="resume")this.paused=false;
      if(event.data==="stop")this.finish("stop");
    };
  }
  flush() {
    if(!this.used)return;
    const chunk=this.buffer.slice(0,this.used);this.port.postMessage({type:"chunk",samples:chunk,total:this.total},[chunk.buffer]);this.used=0;
  }
  finish(reason) {this.flush();this.active=false;this.port.postMessage({type:"complete",reason,total:this.total});}
  process(inputs) {
    if(!this.active)return false;
    if(this.paused)return true;
    const input=inputs[0]?.[0];if(!input)return true;
    for(const value of input){
      const sample=Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
      this.buffer[this.used++]=Math.round(sample*(sample<0?32768:32767));this.total++;
      if(this.used===this.buffer.length)this.flush();
      if(this.total>=16000*600){this.finish("limit");return false;}
    }
    return true;
  }
}
registerProcessor("clinical-dictation-pcm",ClinicalDictationProcessor);
