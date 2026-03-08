import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <h2 className="text-base font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <Button variant="outline" size="sm" onClick={() => this.setState({ hasError: false, error: null })}>
            Try Again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
