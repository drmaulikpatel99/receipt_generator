"use client";

import React, { useState, useEffect } from "react";
import { X, Lock, CheckCircle, AlertCircle, LogOut } from "lucide-react";
import { loginWithSupabase, logoutSupabase } from "@/lib/supabase";

interface SettingsAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  currentUserEmail: string | null;
  onLogout: () => void;
}

export function SettingsAuthModal({
  isOpen,
  onClose,
  onAuthSuccess,
  currentUserEmail,
  onLogout,
}: SettingsAuthModalProps) {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "idle" | "loading" | "success" | "error" }>({
    text: "",
    type: "idle",
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedEmail = localStorage.getItem("sb_email") || "";
      setEmail(savedEmail);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setStatusMsg({ text: "Please enter both Email and Password", type: "error" });
      return;
    }

    setStatusMsg({ text: "Authenticating with Supabase...", type: "loading" });
    try {
      await loginWithSupabase(email, password);
      setStatusMsg({ text: "✓ Authenticated successfully!", type: "success" });
      setTimeout(() => {
        onAuthSuccess();
        onClose();
      }, 600);
    } catch (err: any) {
      console.error(err);
      setStatusMsg({
        text: err.message || "Invalid Email or Password",
        type: "error",
      });
    }
  };

  const handleLogoutClick = async () => {
    try {
      await logoutSupabase();
      onLogout();
      setStatusMsg({ text: "Signed out successfully", type: "idle" });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-sm overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#0E6655] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-teal-200" />
            <h3 className="font-bold text-base">Admin Login</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-teal-100 hover:bg-teal-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-teal-800 dark:text-teal-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Supabase Credentials
              </h4>
              {currentUserEmail && (
                <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Logged In
                </span>
              )}
            </div>

            {currentUserEmail ? (
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Signed in as <strong className="text-slate-900 dark:text-white font-bold">{currentUserEmail}</strong>
                </p>
                <button
                  type="button"
                  onClick={handleLogoutClick}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 mx-auto shadow-sm transition active:scale-95"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Supabase Auth Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@babyscan.com"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#0E6655] outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#0E6655] outline-hidden"
                  />
                </div>

                {statusMsg.text && (
                  <div
                    className={`p-2.5 rounded-xl text-xs font-semibold text-center flex items-center justify-center gap-1.5 ${
                      statusMsg.type === "success"
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : statusMsg.type === "error"
                        ? "bg-rose-50 text-rose-800 border border-rose-200"
                        : "bg-blue-50 text-blue-800 border border-blue-200"
                    }`}
                  >
                    {statusMsg.type === "error" && <AlertCircle className="w-3.5 h-3.5 text-rose-600" />}
                    {statusMsg.type === "success" && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                    {statusMsg.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={statusMsg.type === "loading"}
                  className="w-full py-2.5 bg-[#0E6655] hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-md transition active:scale-98 disabled:opacity-50"
                >
                  {statusMsg.type === "loading" ? "Authenticating..." : "🔑 Log In to Supabase"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
