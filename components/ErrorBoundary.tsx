
import React from 'react';

interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// Fix: Use React.Component explicitly to ensure properties like setState and props are inherited correctly.
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error: error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    // Fix: setState is a method provided by React.Component.
    this.setState({
      error: error,
      errorInfo: errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div style={{ padding: '20px', textAlign: 'center', border: '1px solid red', borderRadius: '8px', margin: '20px', backgroundColor: '#ffe6e6' }}>
          <h2 style={{ color: 'red' }}>Oops! Something went wrong.</h2>
          <p>We're sorry for the inconvenience. Please try refreshing the page.</p>
          {this.state.error && (
            <details style={{ whiteSpace: 'pre-wrap', textAlign: 'left', margin: '20px auto', maxWidth: '600px', backgroundColor: '#fff', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Error Details</summary>
              <p>{this.state.error.toString()}</p>
              <br />
              {this.state.errorInfo?.componentStack}
            </details>
          )}
        </div>
      );
    }

    // Fix: props is a property of the React.Component class.
    return this.props.children;
  }
}

export default ErrorBoundary;
