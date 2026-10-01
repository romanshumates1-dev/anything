"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, Send, X, ChevronDown, User, Bot, Loader2, Headphones } from "lucide-react";
import { SUPPORT_EMAIL, SUPPORT_PHONE } from "@/lib/contact";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

const QUICK_ACTIONS = [
  { label: "How do I create a campaign?", question: "How do I create a new outreach campaign?" },
  { label: "Import leads", question: "How can I import leads into DealFlow AI?" },
  { label: "AI features", question: "What AI features does DealFlow AI offer?" },
  { label: "Pricing info", question: "What are the pricing plans for DealFlow AI?" },
];

export default function SupportChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm the DealFlow AI assistant. I can help you with questions about campaigns, leads, contracts, and more. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Keyboard: Escape dismisses the dialog (a dialog that only closes by
  // pointer is a keyboard trap). Listener lives on the document so it works
  // regardless of which element inside the panel has focus.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setShowQuickActions(false);
    setIsLoading(true);

    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        // Surface the API's own user-facing state instead of a generic
        // failure: the route returns a graceful `content` fallback on AI
        // outages, and static `error` strings for rate limits / auth.
        let body: { error?: unknown; content?: unknown } | null = null;
        try {
          body = (await response.json()) as { error?: unknown; content?: unknown };
        } catch {
          body = null;
        }

        if (body && typeof body.content === "string" && body.content.trim()) {
          setMessages((prev) => [
            ...prev,
            { id: `assistant-${Date.now()}`, role: "assistant", content: body!.content as string, timestamp: new Date() },
          ]);
          return;
        }

        const apiMessage = body && typeof body.error === "string" ? (body.error as string) : "";
        if (response.status === 429) {
          throw new Error(apiMessage || "AI rate limit reached — please try again in a few minutes.");
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error(apiMessage || "Please sign in to use AI support.");
        }
        throw new Error(apiMessage || "The assistant is unavailable right now. Please try again shortly.");
      }

      const data = (await response.json().catch(() => null)) as { content?: unknown } | null;
      if (!data || typeof data.content !== "string" || !data.content.trim()) {
        throw new Error("The assistant returned an empty response. Please try again.");
      }

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Support chat error:", error);
      const detail =
        error instanceof Error && error.message && error.message.length <= 200 ? error.message : "";
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: detail
          ? `${detail} You can also click "Talk to Human" below.`
          : "I'm sorry, I'm having trouble connecting right now. Please try again in a moment, or click \"Talk to Human\" below for direct support.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleQuickAction = (question: string) => {
    sendMessage(question);
  };

  const handleEscalate = () => {
    const escalateMessage: Message = {
      id: `system-${Date.now()}`,
      role: "system",
      content: `Connecting you to human support... A support agent will reach out to you via email shortly. You can also reach us directly at ${SUPPORT_EMAIL} or ${SUPPORT_PHONE}.`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, escalateMessage]);
  };

  return (
    <>
      {/* Floating Button - smaller, quieter, positioned above the Feedback button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-20 right-6 z-50 p-3 rounded-full shadow-lg transition-all duration-300 ${
          isOpen
            ? "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
            : "btn-gradient"
        }`}
        aria-label={isOpen ? "Close support chat" : "Open support chat"}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="h-5 w-5" />
        ) : (
          <MessageSquare className="h-5 w-5" />
        )}
      </button>

      {/* Chat Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-hidden={!isOpen}
        // aria-hidden alone leaves the closed panel's input/buttons reachable
        // by Tab, which is a keyboard trap. `inert` (React 19) removes the
        // whole subtree from focus and the a11y tree while it is closed.
        inert={!isOpen}
        aria-label="DealFlow support chat"
        className={`fixed bottom-32 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] rounded-xl shadow-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] transition-all duration-300 transform ${
          isOpen
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-gradient-to-r from-[var(--accent-blue)]/10 to-[var(--accent-purple)]/10 rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">DealFlow Support</h3>
              <p className="text-xs text-[var(--text-muted)]">AI Assistant</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label="Close chat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="h-80 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  message.role === "user"
                    ? "bg-[var(--accent-blue)]"
                    : message.role === "system"
                    ? "bg-[var(--color-warning)]"
                    : "bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)]"
                }`}
              >
                {message.role === "user" ? (
                  <User className="h-4 w-4 text-white" />
                ) : message.role === "system" ? (
                  <Headphones className="h-4 w-4 text-white" />
                ) : (
                  <Bot className="h-4 w-4 text-white" />
                )}
              </div>
              <div
                className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                  message.role === "user"
                    ? "bg-[var(--accent-blue)] text-white"
                    : message.role === "system"
                    ? "bg-[var(--color-warning)]/20 text-[var(--text-primary)] border border-[var(--color-warning)]/30"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                <p
                  className={`text-xs mt-1 ${
                    message.role === "user" ? "text-white/70" : "text-[var(--text-muted)]"
                  }`}
                >
                  {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="bg-[var(--bg-tertiary)] px-4 py-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-blue)]" />
                  <span className="text-sm text-[var(--text-muted)]">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        {showQuickActions && messages.length <= 1 && (
          <div className="px-4 pb-3">
            <p className="text-xs text-[var(--text-muted)] mb-2">Quick questions:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.question)}
                  className="px-3 py-1.5 text-xs rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--accent-blue)]/20 hover:text-[var(--accent-blue)] transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-[var(--border-subtle)]">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={isLoading}
              className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] text-sm focus:outline-none focus:border-[var(--accent-blue)] focus:ring-2 focus:ring-[var(--accent-blue)]/20 transition-all disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-2 rounded-lg btn-gradient disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </form>

        {/* Footer - Escalate to Human */}
        <div className="px-4 pb-4">
          <button
            onClick={handleEscalate}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] text-sm transition-colors"
          >
            <Headphones className="h-4 w-4" />
            Talk to Human
          </button>
        </div>
      </div>
    </>
  );
}
