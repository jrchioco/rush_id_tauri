import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./index.css";
import "sonner/dist/styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster
        position="top-center"
        closeButton
        duration={4000}
        style={
          {
            "--normal-bg": "#0c0c0b",
            "--normal-border": "#2a2a28",
            "--normal-text": "#e8e4da",
            "--error-bg": "#450a0a",
            "--error-border": "#991b1b",
            "--error-text": "#f87171",
            "--success-bg": "#0a1f12",
            "--success-border": "#166534",
            "--success-text": "#4caf78",
            "--info-bg": "#1a1508",
            "--info-border": "#c8881a",
            "--info-text": "#c8881a",
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: "12px",
            borderRadius: "0.5rem",
          } as React.CSSProperties
        }
      />
    </ErrorBoundary>
  </React.StrictMode>,
);
