import { useState, useEffect, useRef } from "react";
import { useCanWrite } from "@/auth/usePermission";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  Send,
  MessageSquare,
  User,
  Shield,
  Clock,
  Activity,
  CheckCircle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SupportMessage } from "@shared/schema";
import { useAdminSocket } from "@/realtime/useAdminSocket";

export default function SupportThread() {
  const canWrite = useCanWrite();
  const params = useParams<{ deviceUUID: string }>();
  const deviceUUID = params.deviceUUID;
  const [messageText, setMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    joinSupportThread,
    leaveSupportThread,
    sendSupportMessage,
    sendTypingIndicator,
    resolveThread,
    typingDevices,
    isDeviceOnline,
  } = useAdminSocket();

  // Join this device's support room on mount so we get real-time messages
  useEffect(() => {
    if (!deviceUUID) return;
    joinSupportThread(deviceUUID);
    return () => leaveSupportThread(deviceUUID);
  }, [deviceUUID, joinSupportThread, leaveSupportThread]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const isDeviceTyping = typingDevices.get(deviceUUID) === true;

  const { data, isLoading, error } = useQuery<{ messages: SupportMessage[] }>({
    queryKey: ["/api/messages", deviceUUID],
    queryFn: async () => {
      const res = await fetch(`/api/messages/${deviceUUID}`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    // Socket invalidates this automatically; keep a slow fallback just in case
    refetchInterval: 30000,
  });

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      // HTTP route persists the message and emits socket events to device + other admins
      return apiRequest("POST", `/api/messages/${deviceUUID}/reply`, {
        text,
        sender: "admin",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", deviceUUID] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support/threads"] });
      setMessageText("");
    },
  });

  const resolveThreadMutation = useMutation({
    mutationFn: async () => {
      // Emit socket event first so device gets real-time resolved notification
      resolveThread(deviceUUID);
      return apiRequest("DELETE", `/api/admin/support/threads/${deviceUUID}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages", deviceUUID] });
      window.location.href = "/support";
    },
  });

  const isOnline = isDeviceOnline(deviceUUID);

  const handleSend = () => {
    if (messageText.trim()) {
      sendMessage.mutate(messageText.trim());
    }
  };

  const handleTyping = (value: string) => {
    setMessageText(value);
    sendTypingIndicator(deviceUUID, true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sendTypingIndicator(deviceUUID, false);
    }, 1500);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const messages = data?.messages || [];

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-card max-w-md p-8 rounded-2xl text-center border-red-500/20">
          <h2 className="text-xl font-bold text-white mb-2">Error Loading Messages</h2>
          <p className="text-muted-foreground">Could not fetch support thread.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col font-body">
      <div className="border-b border-white/5 p-4">
        <div className="flex items-center gap-3">
          <Link href="/support">
            <a
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              data-testid="link-back-support"
            >
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </a>
          </Link>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-display font-bold tracking-tight text-white">
                Support Thread
              </h1>
              <span
                className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                  isOnline
                    ? "bg-green-500/10 text-green-400 border border-green-500/20"
                    : "bg-white/5 text-muted-foreground border border-white/10"
                }`}
              >
                {isOnline ? (
                  <Wifi className="w-3 h-3" />
                ) : (
                  <WifiOff className="w-3 h-3" />
                )}
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px] sm:max-w-none">
              {deviceUUID}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-green-500/30 text-green-400 hover:bg-green-500/10"
            onClick={() => resolveThreadMutation.mutate()}
            disabled={!canWrite || resolveThreadMutation.isPending}
            data-testid="button-resolve-thread"
          >
            <CheckCircle className="w-4 h-4 mr-1.5" />
            {resolveThreadMutation.isPending ? "Resolving…" : "Resolved"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col max-w-4xl mx-auto w-full">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-8 h-8 bg-white/10 rounded-full" />
                  <div className="flex-1">
                    <div className="h-4 bg-white/10 rounded w-1/4 mb-2" />
                    <div className="h-16 bg-white/5 rounded-xl w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Messages Yet</h3>
              <p className="text-muted-foreground text-sm max-w-xs">
                This support thread is empty. Send a message to start the conversation.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.sender === "admin" ? "flex-row-reverse" : ""}`}
                data-testid={`message-${msg.id}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.sender === "admin"
                      ? "bg-primary/10 text-primary"
                      : "bg-white/10 text-muted-foreground"
                  }`}
                >
                  {msg.sender === "admin" ? (
                    <Shield className="w-4 h-4" />
                  ) : (
                    <User className="w-4 h-4" />
                  )}
                </div>

                <div className={`max-w-[70%] ${msg.sender === "admin" ? "text-right" : ""}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {msg.sender === "admin" ? "Admin" : "Device"}
                    </span>
                    <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <div
                    className={`inline-block p-3 rounded-xl text-sm ${
                      msg.sender === "admin"
                        ? "bg-primary/10 text-white border border-primary/20"
                        : "glass-card"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Device typing indicator */}
          {isDeviceTyping && (
            <div className="flex gap-3 items-center">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                <Activity className="w-4 h-4 text-primary animate-pulse" />
              </div>
              <div className="glass-card px-4 py-2 rounded-xl text-sm text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-white/5 p-4">
          <div className="flex gap-3">
            <Textarea
              value={messageText}
              onChange={(e) => handleTyping(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 min-h-[80px] resize-none bg-white/5 border-white/10 focus:border-primary/50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              data-testid="input-message"
            />
            <Button
              onClick={handleSend}
              disabled={!canWrite || !messageText.trim() || sendMessage.isPending}
              className="self-end"
              data-testid="button-send-message"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
