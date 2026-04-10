import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { getCharacterImagePath, getCharacterShortName } from '../lib/characters';

interface ChatMessage {
  id: string;
  user_id: string;
  room: string;
  content: string;
  connect_code: string;
  display_name: string | null;
  created_at: string;
}

interface ChatProfile {
  connect_code: string;
  avatar_url: string | null;
  main_character: number | null;
  hide_avatar: boolean;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Deduplicate by id, then sort by created_at ascending. */
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of existing) map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatDisabled, setChatDisabled] = useState(false);
  const [disabledByUser, setDisabledByUser] = useState(false);
  const [chatBanned, setChatBanned] = useState(false);
  const [muted, setMuted] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [blockedCodes, setBlockedCodes] = useState<Set<string>>(new Set());
  const [myConnectCode, setMyConnectCode] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: ChatMessage } | null>(null);
  const [muteTarget, setMuteTarget] = useState<string | null>(null);
  const [profileCache, setProfileCache] = useState<Map<string, ChatProfile>>(new Map());
  const profileCacheRef = useRef<Map<string, ChatProfile>>(profileCache);
  profileCacheRef.current = profileCache;
  const profileFetchingRef = useRef<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoScrollRef = useRef(true);

  const outerRef = useRef<HTMLDivElement>(null);

  const ADMIN_CODES = ['SMOK#1', 'BF#0', 'BURN#0', 'BURN#1'];
  const PAGE_SIZE = 50;

  useLayoutEffect(() => {
    function setHeight() {
      const el = outerRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      el.style.height = `${window.innerHeight - top - 24}px`;
    }
    setHeight();
    window.addEventListener('resize', setHeight);
    const ro = new ResizeObserver(setHeight);
    if (outerRef.current?.parentElement) ro.observe(outerRef.current.parentElement);
    return () => { window.removeEventListener('resize', setHeight); ro.disconnect(); };
  }, [loading, chatDisabled]);

  const ensureProfile = useCallback((connectCode: string) => {
    if (profileCacheRef.current.has(connectCode) || profileFetchingRef.current.has(connectCode)) return;
    profileFetchingRef.current.add(connectCode);
    window.api.chatProfile(connectCode).then((p) => {
      profileFetchingRef.current.delete(connectCode);
      if (p) {
        setProfileCache((prev) => {
          const next = new Map(prev);
          next.set(connectCode, p);
          return next;
        });
      }
    });
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  // Track whether user is scrolled to bottom
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 60;
  }, []);

  // Init: check enabled, load identity, load blocked users, subscribe
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const [enabled, identity, blocked, userSettings] = await Promise.all([
          window.api.chatEnabled(),
          window.api.getIdentity(),
          window.api.getBlockedUsers().catch(() => []),
          window.api.getSettings(),
        ]);

        if (!mounted) return;

        if (userSettings?.disableChat) {
          setChatDisabled(true);
          setDisabledByUser(true);
          setLoading(false);
          return;
        }

        if (!enabled) {
          setChatDisabled(true);
          setLoading(false);
          return;
        }

        if (identity?.connectCode) {
          setMyConnectCode(identity.connectCode);
          if (ADMIN_CODES.includes(identity.connectCode)) setIsAdmin(true);
        }

        setBlockedCodes(new Set((blocked || []).map((b: any) => b.connectCode)));

        const [isMuted, isBanned] = await Promise.all([
          window.api.chatIsMuted().catch(() => false),
          window.api.chatIsBanned().catch(() => false),
        ]);
        if (!mounted) return;
        setMuted(isMuted);

        if (isBanned) {
          setChatBanned(true);
          setChatDisabled(true);
          setLoading(false);
          return;
        }

        const subResult = await window.api.chatSubscribe('general');
        if (!mounted) return;

        if (!subResult.ok) {
          setChatDisabled(true);
          setLoading(false);
          return;
        }

        const result = await window.api.chatHistory({ room: 'general', limit: PAGE_SIZE });
        if (!mounted) return;

        const history = result?.messages || result || [];
        const profiles = result?.profiles || {};
        setMessages(history);
        setHasMore(history.length >= PAGE_SIZE);

        if (Object.keys(profiles).length > 0) {
          setProfileCache((prev) => {
            const next = new Map(prev);
            for (const [code, p] of Object.entries(profiles)) next.set(code, p as ChatProfile);
            return next;
          });
        }

        setLoading(false);
      } catch (e) {
        console.error('[chat] init failed:', e);
        if (mounted) {
          setError('Chat failed to load. Try switching tabs and coming back.');
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      mounted = false;
      window.api.chatUnsubscribe();
    };
  }, [scrollToBottom]);

  // Auto-scroll when messages change (initial load + new messages)
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (loading) return;
    const isInitial = prevMsgCountRef.current === 0 && messages.length > 0;
    if (isInitial || autoScrollRef.current) {
      requestAnimationFrame(() => scrollToBottom());
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, loading, scrollToBottom]);

  // Real-time message listener — dedup + sort on every insert
  useEffect(() => {
    const unsubMsg = window.api.onChatMessage((msg: ChatMessage) => {
      setMessages((prev) => mergeMessages(prev, [msg]));
      ensureProfile(msg.connect_code);
    });

    const unsubDel = window.api.onChatMessageDeleted(({ id }: { id: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    });

    const unsubOnline = window.api.onChatOnlineCount((count: number) => {
      setOnlineCount(count);
    });

    return () => { unsubMsg(); unsubDel(); unsubOnline(); };
  }, [ensureProfile]);

  // Catch-up on visibility: fetch messages since last known timestamp to fill gaps
  useEffect(() => {
    function onVisible() {
      if (document.hidden || chatDisabled) return;
      window.api.chatHistory({ room: 'general', limit: PAGE_SIZE }).then((result) => {
        const fresh = result?.messages || result || [];
        const profiles = result?.profiles || {};
        if (fresh.length > 0) {
          setMessages((cur) => mergeMessages(cur, fresh));
        }
        if (Object.keys(profiles).length > 0) {
          setProfileCache((prev) => {
            const next = new Map(prev);
            for (const [code, p] of Object.entries(profiles)) next.set(code, p as ChatProfile);
            return next;
          });
        }
      });
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [chatDisabled]);

  // Close context menu on click elsewhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  async function loadOlder() {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const oldest = messages[0]?.created_at;
    const result = await window.api.chatHistory({ room: 'general', before: oldest, limit: PAGE_SIZE });
    const older = result?.messages || result || [];
    const profiles = result?.profiles || {};
    if (older.length > 0) {
      setMessages((prev) => mergeMessages(prev, older));
      setHasMore(older.length >= PAGE_SIZE);
      if (Object.keys(profiles).length > 0) {
        setProfileCache((prev) => {
          const next = new Map(prev);
          for (const [code, p] of Object.entries(profiles)) next.set(code, p as ChatProfile);
          return next;
        });
      }
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  }

  async function handleSend() {
    if (!input.trim() || sending || muted) return;
    setSending(true);
    setError(null);
    const result = await window.api.chatSend(input.trim(), 'general');
    if (result.error) {
      setError(result.error);
      setTimeout(() => setError(null), 4000);
    } else {
      setInput('');
    }
    setSending(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function handleDelete(messageId: string) {
    const result = await window.api.chatDelete(messageId);
    if (result.error) {
      setError(result.error);
      setTimeout(() => setError(null), 3000);
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
    setContextMenu(null);
  }

  async function handleAdminDelete(messageId: string) {
    const result = await window.api.chatAdminDelete(messageId);
    if (result.error) {
      setError(result.error);
      setTimeout(() => setError(null), 3000);
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
    setContextMenu(null);
  }

  async function handleReport(messageId: string) {
    const result = await window.api.chatReport(messageId);
    if (result.error) {
      setError(result.error);
    } else {
      setError('Report submitted');
    }
    setTimeout(() => setError(null), 3000);
    setContextMenu(null);
  }

  async function handleBlock(connectCode: string) {
    await window.api.blockUser(connectCode);
    setBlockedCodes((prev) => new Set([...prev, connectCode]));
    setContextMenu(null);
  }

  async function handleAdminMute(connectCode: string, minutes?: number) {
    const result = await window.api.chatAdminMute(connectCode, minutes);
    if (result.error) {
      setError(result.error);
      setTimeout(() => setError(null), 3000);
    }
    setMuteTarget(null);
    setContextMenu(null);
  }

  const filtered = messages.filter((m) => !blockedCodes.has(m.connect_code));

  if (chatDisabled) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-display font-bold">Chat</h1>
          <p className="text-xs text-gray-500 mt-0.5">Be respectful for the love of God. Let's see if we can last more than 14 minutes...enjoy :)</p>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-8 text-center">
          <p className="text-gray-400">
            {chatBanned
              ? 'Chat is disabled for your account.'
              : disabledByUser
                ? 'Chat is disabled. You can re-enable it in Settings → Social Features.'
                : 'Chat is currently disabled.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={outerRef} className="flex flex-col max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Chat</h1>
          <p className="text-xs text-gray-500 mt-0.5">Be respectful for the love of God. Let's see if we can last more than 14 minutes...enjoy :)</p>
        </div>
        {onlineCount > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141414] border border-[#2a2a2a]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#21BA45] shadow-[0_0_4px_rgba(33,186,69,0.5)]" />
            <span className="text-xs text-gray-400">{onlineCount} in chat</span>
          </div>
        )}
      </div>

      {/* Messages area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#0f0f0f]"
      >
        {/* Load older */}
        {hasMore && !loading && (
          <div className="p-2 text-center">
            <button
              onClick={loadOlder}
              disabled={loadingMore}
              className="text-xs text-gray-500 hover:text-[#21BA45] transition-colors px-3 py-1.5 rounded-lg hover:bg-[#21BA45]/5"
            >
              {loadingMore ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-7 h-7 rounded-full bg-[#1a1a1a] shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3 w-20 rounded bg-[#1a1a1a]" />
                  <div className="h-3 w-48 rounded bg-[#1a1a1a]" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500 text-sm">No messages yet. Say something!</p>
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            {filtered.map((msg, i) => {
              const isOwn = msg.connect_code === myConnectCode;
              const prev = i > 0 ? filtered[i - 1] : null;
              const sameAuthor = prev?.connect_code === msg.connect_code;
              const timeDiff = prev ? new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() : Infinity;
              const grouped = sameAuthor && timeDiff < 120_000;

              return (
                <div
                  key={msg.id}
                  className={`group flex gap-2.5 px-2 py-0.5 rounded-lg hover:bg-white/[0.02] ${grouped ? '' : 'mt-2'}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, msg });
                  }}
                >
                  {/* Avatar / spacer */}
                  <div className="w-7 shrink-0 pt-0.5">
                    {!grouped && (() => {
                      const profile = profileCache.get(msg.connect_code);
                      const avatarUrl = profile?.avatar_url;
                      const charId = profile?.main_character;
                      const charImg = charId != null ? getCharacterImagePath(charId) : '';

                      if (avatarUrl) {
                        return (
                          <img
                            src={avatarUrl}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover border border-[#2a2a2a]"
                          />
                        );
                      }
                      if (charImg) {
                        return (
                          <div className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center overflow-hidden">
                            <img src={charImg} alt={getCharacterShortName(charId!)} className="w-5 h-5 object-contain" />
                          </div>
                        );
                      }
                      return (
                        <div className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-[10px] font-bold text-gray-500">
                          {(msg.connect_code || '??').slice(0, 2)}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex-1 min-w-0">
                    {!grouped && (
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span
                          className={`text-xs font-semibold truncate ${ADMIN_CODES.includes(msg.connect_code) ? 'text-[#21BA45]' : 'text-gray-300'}`}
                          title={msg.connect_code}
                        >
                          {msg.display_name || msg.connect_code}
                        </span>
                        <span className="text-[10px] text-gray-600 shrink-0">
                          {msg.connect_code}
                        </span>
                        <span className="text-[10px] text-gray-600 shrink-0">
                          {formatTimestamp(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <p className="text-[13px] text-gray-300 break-words leading-relaxed">{msg.content}</p>
                  </div>

                  {/* Hover timestamp for grouped messages */}
                  {grouped && (
                    <span className="invisible group-hover:visible text-[10px] text-gray-600 shrink-0 self-center">
                      {formatTimestamp(msg.created_at)}
                    </span>
                  )}

                  {/* Three-dot menu button on hover */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Open message menu"
                    className="flex invisible group-hover:visible shrink-0 self-center w-6 h-6 items-center justify-center rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setContextMenu({ x: e.currentTarget.getBoundingClientRect().left - 140, y: e.currentTarget.getBoundingClientRect().bottom + 4, msg });
                    }}
                    onMouseLeave={(e) => e.currentTarget.blur()}
                  >
                    ⋯
                  </button>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error bar */}
      {error && (
        <div className="mt-1 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Muted bar */}
      {muted && (
        <div className="mt-1 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-400">
          You are muted from chat.
        </div>
      )}

      {/* Input */}
      <div className="mt-2 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 500))}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={muted ? 'You are muted' : 'Type a message...'}
          disabled={muted || sending}
          className="flex-1 px-4 py-2.5 rounded-xl bg-[#141414] border border-[#2a2a2a] text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#21BA45]/50 transition-colors disabled:opacity-50"
          maxLength={500}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending || muted}
          className="px-5 py-2.5 rounded-xl bg-[#21BA45] text-sm font-medium text-white hover:bg-[#1da83e] transition-colors disabled:opacity-30 disabled:hover:bg-[#21BA45] shrink-0"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-600">
          {input.length > 0 && `${input.length}/500`}
        </span>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.msg.connect_code === myConnectCode && (
            <button
              onClick={() => handleDelete(contextMenu.msg.id)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              Delete message
            </button>
          )}
          {contextMenu.msg.connect_code !== myConnectCode && (
            <>
              <button
                onClick={() => handleReport(contextMenu.msg.id)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                Report message
              </button>
              <button
                onClick={() => handleBlock(contextMenu.msg.connect_code)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-red-400 transition-colors"
              >
                Block {contextMenu.msg.connect_code}
              </button>
            </>
          )}
          {isAdmin && contextMenu.msg.connect_code !== myConnectCode && (
            <>
              <div className="border-t border-[#2a2a2a] my-1" />
              <button
                onClick={() => handleAdminDelete(contextMenu.msg.id)}
                className="w-full text-left px-3 py-1.5 text-xs text-orange-400 hover:bg-orange-500/10 transition-colors"
              >
                Admin: Delete message
              </button>
              <button
                onClick={() => setMuteTarget(contextMenu.msg.connect_code)}
                className="w-full text-left px-3 py-1.5 text-xs text-orange-400 hover:bg-orange-500/10 transition-colors"
              >
                Admin: Mute user
              </button>
            </>
          )}
        </div>
      )}

      {/* Admin mute modal */}
      {muteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-5 w-80 space-y-3">
            <h3 className="text-sm font-bold text-white">Mute {muteTarget}</h3>
            <div className="space-y-2">
              {[
                { label: '1 hour', minutes: 60 },
                { label: '24 hours', minutes: 1440 },
                { label: '1 week', minutes: 10080 },
                { label: 'Permanent', minutes: undefined },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => handleAdminMute(muteTarget, opt.minutes)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors border border-[#2a2a2a]"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setMuteTarget(null)}
              className="w-full text-center px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
