import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Database } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  key?: React.Key;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleClearCorruptedCache = () => {
    try {
      // Clean only corrupted punches or reset biometric punch cache
      const rawPunches = localStorage.getItem('siemens_ix_raw_punches');
      if (rawPunches) {
        try {
          const parsed = JSON.parse(rawPunches);
          if (Array.isArray(parsed)) {
            const clean = parsed.filter(p => p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim() !== '');
            localStorage.setItem('siemens_ix_raw_punches', JSON.stringify(clean));
          }
        } catch {
          localStorage.removeItem('siemens_ix_raw_punches');
        }
      }
    } catch {
      // ignore
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d1620] text-slate-200 flex items-center justify-center p-6 select-none">
          <div className="max-w-xl w-full bg-[#152332] border border-red-500/40 rounded-xl shadow-2xl p-6 sm:p-8 space-y-6">
            <div className="flex items-start space-x-4">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 shrink-0">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-white tracking-tight">
                  {this.props.fallbackTitle || 'ระบบป้องกันจอขาว (Error Boundary Intercepted)'}
                </h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  เกิดข้อผิดพลาดในการประมวลผลข้อมูลการสแกนเวลาหรือการคำนวณสถิติ ระบบดักจับข้อผิดพลาดไว้เพื่อป้องกันหน้าจอขาวค้าง
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="p-4 rounded-lg bg-black/40 border border-slate-700/60 font-mono text-xs text-red-300 overflow-x-auto space-y-1 max-h-48 scrollbar-thin">
                <div className="font-bold text-red-400 flex items-center gap-1.5">
                  <span>รายละเอียดข้อผิดพลาด:</span>
                </div>
                <div className="text-slate-300 break-words">{this.state.error.toString()}</div>
                {this.state.errorInfo?.componentStack && (
                  <pre className="text-[10px] text-slate-500 pt-2 border-t border-slate-800 whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack.slice(0, 500)}...
                  </pre>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg bg-[#008b99] hover:bg-[#007380] text-white font-semibold text-sm transition shadow-lg shadow-teal-900/30"
              >
                <RotateCcw className="w-4 h-4" />
                <span>ลองประมวลผลใหม่อีกครั้ง</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="w-full inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-sm transition"
              >
                <RefreshCw className="w-4 h-4" />
                <span>รีเฟรชหน้าต่าง (Reload)</span>
              </button>

              <button
                type="button"
                onClick={this.handleClearCorruptedCache}
                className="w-full sm:col-span-2 inline-flex items-center justify-center space-x-2 px-4 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 text-red-300 font-medium text-xs transition"
              >
                <Database className="w-4 h-4" />
                <span>ทำความสะอาดข้อมูลสแกนเวลาที่ผิดปกติ (Clean Corrupted Punch Cache)</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
