import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { sendToRenderer } from './ipc';
import { getCurrentUser } from './auth';
import { getIdentity } from './identity';
import { chatLog } from './logger';

export interface ChatMessage {
  id: string;
  user_id: string;
  room: string;
  content: string;
  connect_code: string;
  display_name: string | null;
  deleted_at: string | null;
  created_at: string;
}

let chatChannel: RealtimeChannel | null = null;
let chatPresenceChannel: RealtimeChannel | null = null;
let currentRoom: string | null = null;
let chatEnabled: boolean | null = null;
let chatEnabledAt = 0;
const CHAT_ENABLED_TTL = 30_000;

let blockedCodesCache: Set<string> | null = null;
let blockedCodesCacheAt = 0;
const BLOCKED_CODES_TTL = 15_000;

export async function isChatEnabled(): Promise<boolean> {
  if (chatEnabled !== null && Date.now() - chatEnabledAt < CHAT_ENABLED_TTL) {
    return chatEnabled;
  }
  try {
    const { data } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'chat_enabled')
      .single();
    chatEnabled = data?.value === 'true';
    chatEnabledAt = Date.now();
    return chatEnabled;
  } catch {
    return false;
  }
}

async function getBlockedCodes(): Promise<Set<string>> {
  if (blockedCodesCache && Date.now() - blockedCodesCacheAt < BLOCKED_CODES_TTL) {
    return blockedCodesCache;
  }
  try {
    const user = await getCurrentUser();
    if (!user) return new Set();
    const { data } = await supabase
      .from('blocked_users')
      .select('blocked_connect_code')
      .eq('user_id', user.id);
    blockedCodesCache = new Set((data ?? []).map((r: any) => r.blocked_connect_code));
    blockedCodesCacheAt = Date.now();
    return blockedCodesCache;
  } catch {
    return blockedCodesCache ?? new Set();
  }
}

export function invalidateBlockCache(): void {
  blockedCodesCache = null;
  blockedCodesCacheAt = 0;
}

export async function checkChatBanned(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) return false;
    const { data } = await supabase.rpc('get_blocked_by_count', { target_user_id: user.id });
    return typeof data === 'number' && data >= 5;
  } catch {
    return false;
  }
}

export async function subscribeChatRoom(room: string): Promise<boolean> {
  if (currentRoom === room && chatChannel) return true;

  await unsubscribeChatRoom();
  currentRoom = room;

  chatChannel = supabase
    .channel(`chat:${room}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `room=eq.${room}`,
      },
      async (payload) => {
        const msg = payload.new as any;
        const blocked = await getBlockedCodes();
        if (msg?.connect_code && blocked.has(msg.connect_code)) return;
        sendToRenderer('chat:newMessage', msg);
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `room=eq.${room}`,
      },
      (payload) => {
        if (payload.new && (payload.new as any).deleted_at) {
          sendToRenderer('chat:messageDeleted', { id: (payload.new as any).id });
        }
      },
    );

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('chat subscribe timeout')), 10_000);
      chatChannel!.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error(`chat subscribe ${status}: ${err}`));
        }
      });
    });
    console.log('[chat] Subscribed to room:', room);
    chatLog.info('Subscribed to room:', room);
    return true;
  } catch (e) {
    console.error('[chat] Subscribe failed:', e);
    chatLog.error('Subscribe failed:', e);
    chatChannel = null;
    currentRoom = null;
    return false;
  }
}

export async function unsubscribeChatRoom(): Promise<void> {
  if (chatChannel) {
    try { await chatChannel.unsubscribe(); } catch {}
    chatChannel = null;
  }
  if (chatPresenceChannel) {
    try {
      await chatPresenceChannel.untrack();
      await chatPresenceChannel.unsubscribe();
    } catch {}
    chatPresenceChannel = null;
  }
  currentRoom = null;
}

export async function joinChatPresence(room: string): Promise<void> {
  if (chatPresenceChannel) {
    try {
      await chatPresenceChannel.untrack();
      await chatPresenceChannel.unsubscribe();
    } catch {}
    chatPresenceChannel = null;
  }

  const identity = getIdentity();
  if (!identity?.connectCode) return;

  chatPresenceChannel = supabase.channel(`chat-presence:${room}`, {
    config: { presence: { key: identity.connectCode } },
  });

  chatPresenceChannel.on('presence', { event: 'sync' }, () => {
    const state = chatPresenceChannel!.presenceState();
    const count = Object.keys(state).length;
    sendToRenderer('chat:onlineCount', count);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('chat presence timeout')), 10_000);
      chatPresenceChannel!.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error(`chat presence ${status}: ${err}`));
        }
      });
    });
    await chatPresenceChannel.track({
      connectCode: identity.connectCode,
      displayName: identity.displayName || identity.connectCode,
    });
    console.log('[chat] Presence joined for room:', room);
    chatLog.info('Presence joined for room:', room);
  } catch (e) {
    console.error('[chat] Presence join failed:', e);
    chatLog.error('Presence join failed:', e);
  }
}

export async function sendChatMessage(content: string, room = 'general'): Promise<{ error?: string }> {
  const enabled = await isChatEnabled();
  if (!enabled) return { error: 'Chat is currently disabled' };

  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const identity = getIdentity();
  if (!identity?.connectCode) return { error: 'No connect code' };

  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 500) return { error: 'Message must be 1-500 characters' };

  const { error } = await supabase.from('chat_messages').insert({
    user_id: user.id,
    room,
    content: trimmed,
    connect_code: identity.connectCode,
    display_name: identity.displayName || null,
  });

  if (error) {
    if (error.message.includes('rate limit')) return { error: 'Slow down! Wait a few seconds.' };
    if (error.message.includes('muted')) return { error: 'You are muted from chat' };
    if (error.message.includes('disabled for your account')) return { error: 'Chat is disabled for your account' };
    if (error.message.includes('disabled')) return { error: 'Chat is currently disabled' };
    if (error.message.includes('inappropriate')) return { error: 'Message contains inappropriate content' };
    if (error.message.includes('character spam')) return { error: 'Message rejected: too much character repetition' };
    if (error.message.includes('shout')) return { error: 'Message rejected: please turn off caps lock' };
    if (error.message.includes('Links')) return { error: 'Links are not allowed in chat' };
    if (error.message.includes('Duplicate')) return { error: 'You already sent that message' };
    return { error: error.message };
  }

  return {};
}

export interface ChatProfile {
  connect_code: string;
  avatar_url: string | null;
  main_character: number | null;
  hide_avatar: boolean;
}

export interface ChatHistoryResult {
  messages: ChatMessage[];
  profiles: Record<string, ChatProfile>;
}

export async function getChatHistory(
  room = 'general',
  before?: string,
  limit = 50,
): Promise<ChatHistoryResult> {
  let query = supabase
    .from('chat_messages')
    .select('*')
    .eq('room', room)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) { console.error('[chat] history error:', error.message); chatLog.error('history error:', error.message); return { messages: [], profiles: {} }; }

  const blocked = await getBlockedCodes();
  const messages = (data ?? [])
    .reverse()
    .filter((m: any) => !blocked.has(m.connect_code)) as ChatMessage[];
  const profiles = await fetchProfilesForMessages(messages);
  return { messages, profiles };
}

async function fetchProfilesForMessages(
  messages: ChatMessage[],
): Promise<Record<string, ChatProfile>> {
  const codes = [...new Set(messages.map((m) => m.connect_code).filter(Boolean))];
  if (codes.length === 0) return {};

  const { data } = await supabase
    .from('profiles')
    .select('connect_code, avatar_url, main_character, hide_avatar')
    .in('connect_code', codes);

  const map: Record<string, ChatProfile> = {};
  if (data) {
    for (const p of data as any[]) {
      map[p.connect_code] = {
        connect_code: p.connect_code,
        avatar_url: p.hide_avatar ? null : (p.avatar_url || null),
        main_character: p.main_character ?? null,
        hide_avatar: p.hide_avatar ?? false,
      };
    }
  }
  return map;
}

export async function deleteChatMessage(messageId: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const { data, error } = await supabase.rpc('owner_delete_chat_message', { msg_id: messageId });
  if (error) return { error: error.message };
  if (data === false) return { error: 'Could not delete message' };
  return {};
}

export async function reportChatMessage(
  messageId: string,
  reason?: string,
): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase.from('chat_reports').insert({
    message_id: messageId,
    reporter_id: user.id,
    reason: reason || null,
  });

  if (error) {
    if (error.message.includes('duplicate')) return { error: 'Already reported' };
    return { error: error.message };
  }
  return {};
}

export async function lookupChatProfile(connectCode: string): Promise<ChatProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('connect_code, avatar_url, main_character, hide_avatar')
    .eq('connect_code', connectCode)
    .maybeSingle();
  if (!data) return null;
  return {
    connect_code: data.connect_code,
    avatar_url: (data as any).hide_avatar ? null : ((data as any).avatar_url || null),
    main_character: (data as any).main_character ?? null,
    hide_avatar: (data as any).hide_avatar ?? false,
  };
}

export async function checkMuted(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;

  const { data } = await supabase
    .from('chat_mutes')
    .select('id, expires_at')
    .eq('user_id', user.id)
    .limit(1);

  if (!data || data.length === 0) return false;
  const mute = data[0];
  if (mute.expires_at && new Date(mute.expires_at) < new Date()) return false;
  return true;
}
