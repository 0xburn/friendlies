import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayerCard } from '../components/PlayerCard';
import { CharacterIcon } from '../components/CharacterIcon';
import {
  CHARACTER_MAP,
  getCharacterShortName,
  SLIPPI_TO_STARTGG_CHAR,
  LEGAL_STAGES,
} from '../lib/characters';
import { getRankLabel, getRankTier } from '../lib/ranks';

type CashboxStartGgSocial = { type: string; handle: string; url: string | null };
type LuckyStatsOpponent = {
  elo: number | null;
  wins: number | null;
  losses: number | null;
  rank: number | null;
};

type CashboxFriendlies = {
  onNetwork: boolean;
  connectCode: string | null;
  displayName: string | null;
  discordUsername: string | null;
  discordId: string | null;
  avatarUrl: string | null;
  rating: number | null;
  mainCharacter: number | null;
  topCharacters: { characterId: number; gameCount: number }[];
  region: string | null;
  status: 'online' | 'in-game' | 'idle' | 'offline';
  currentCharacter: number | null;
  opponentCode: string | null;
  playingSince: string | null;
  connectionType: 'wifi' | 'ethernet' | null;
  lookingToPlay: boolean;
  statusPreset: string | null;
  friendStatus: 'none' | 'friends' | 'pending_out' | 'pending_in';
};

type CashboxModerationTask = {
  id: string;
  title: string;
  stateLabel: string;
  complete: boolean;
  order: number;
  setId: string | null;
};

type CashboxMatchModeration = {
  phaseGroupId: string | null;
  setId: string;
  setUrl: string;
  tasks: CashboxModerationTask[];
  phaseGroupFetched: boolean;
  hint: string | null;
};

type NextMatch = {
  setId: string;
  phaseGroupId: string | null;
  roundText: string;
  scoreDisplay: string | null;
  bestOf: number | null;
  selfEntrantId: string;
  selfEntrantName: string;
  opponentName: string | null;
  opponentEntrantId: string | null;
  startGg: null | {
    userId?: string | null;
    gamerTags: string[];
    prefix: string | null;
    socials: CashboxStartGgSocial[];
    userSlug: string | null;
  };
  slippiConnectCode: string | null;
  slippiMapMissing: boolean;
  friendlies?: CashboxFriendlies;
};

type Snapshot =
  | { ok: false; reason: string; message?: string; giveawayRegisterUrl?: string; startggConnected?: boolean }
  | {
      ok: true;
      entrantName: string;
      tournamentName: string;
      eventName: string;
      bracketUrl: string;
      bracketEmbedUrl: string;
      giveawayRegisterUrl: string;
      extras: {
        initialSeed: number | null;
        isDisqualified: boolean;
        eventEntrantCount: number | null;
        eventStartAt: number | null;
        eventState: string | null;
        streamQueues: { streamLabel: string; setLabel: string }[];
      };
      nextMatch: NextMatch | null;
      recentMatches: {
        setId: string;
        roundText: string;
        scoreDisplay: string | null;
        opponentName: string | null;
        won: boolean | null;
      }[];
      bracketSets: {
        setId: string;
        roundText: string;
        round: number | null;
        state: 'pending' | 'complete';
        scoreDisplay: string | null;
        opponentName: string | null;
        won: boolean | null;
      }[];
      entrantId: string;
      currentPhasePool: {
        phaseGroupId: string;
        title: string;
        matches: {
          setId: string;
          poolSpot: string | null;
          roundText: string;
          round: number | null;
          scoreDisplay: string | null;
          completed: boolean;
          involvesViewer: boolean;
          sideLeft: { entrantId: string; name: string } | null;
          sideRight: { entrantId: string; name: string } | null;
        }[];
      } | null;
      matchModeration: CashboxMatchModeration | null;
      record: { wins: number; losses: number };
    };

const FRIENDLIES_URL = 'https://luckystats.gg/friendlies';
const SIEGE_INFO_URL = 'https://start.gg/fullhouse';
const FALLBACK_CASHBOX_REGISTER = 'https://www.start.gg/tournament/the-cashbox-21/register';

function coerceNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractLuckyStatsPlayer(raw: any, id: string): LuckyStatsOpponent | null {
  const candidates: any[] = [];
  if (Array.isArray(raw)) candidates.push(...raw);
  if (Array.isArray(raw?.players)) candidates.push(...raw.players);
  if (Array.isArray(raw?.data)) candidates.push(...raw.data);
  if (Array.isArray(raw?.data?.players)) candidates.push(...raw.data.players);
  const byId = raw?.playersById?.[id] ?? raw?.data?.playersById?.[id] ?? raw?.[id];
  if (byId) candidates.push(byId);

  const row = candidates.find((p) => {
    const ids = [
      p?.id,
      p?.startggUserId,
      p?.startgg_user_id,
      p?.startggId,
      p?.startgg_id,
      p?.playerId,
    ].map((v) => String(v ?? ''));
    return ids.includes(String(id));
  });
  if (!row) return null;

  return {
    elo: coerceNum(row.elo ?? row.Elo ?? row.rating ?? row.mmr ?? row.points),
    wins: coerceNum(row.wins ?? row.setWins ?? row.win_count),
    losses: coerceNum(row.losses ?? row.setLosses ?? row.loss_count),
    rank: coerceNum(row.rank ?? row.placement ?? row.globalRank),
  };
}

function GiveawayPromoCard({ registerUrl }: { registerUrl?: string | null }) {
  const reg = (registerUrl && registerUrl.trim()) || FALLBACK_CASHBOX_REGISTER;
  return (
    <div className="rounded-xl border border-amber-500/25 bg-gradient-to-b from-amber-500/10 to-[#111] overflow-hidden">
      <div className="px-4 pt-4 pb-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <img
            src="./giveaway.png"
            alt="Cashbox x friendlies giveaway"
            className="w-full sm:w-44 shrink-0 rounded-lg border border-amber-500/20 object-cover max-h-40 sm:max-h-none"
          />
          <div className="space-y-2 min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-400/90">Cashbox x FRIENDLIES</p>
            <p className="text-sm text-gray-200 leading-relaxed">
              Register for Cashbox #21 on StartGG! Use this tab during the event to be eligible for the Full House: Siege signed controller giveaway!
              You'll be able to check-in to your matches, choose characters/stages, and launch Melee to their Connect Code directly!
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void window.api.openExternal(reg)}
                className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black hover:bg-amber-400 transition-colors"
              >
                Register on start.gg (Cashbox)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatStartGgTimestamp(t: number | null): string | null {
  if (t == null) return null;
  const ms = t > 1_000_000_000_000 ? t : t * 1000;
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return null;
  }
}

function CashboxMatchModerationPanel({
  mod,
  onRefresh,
  parentLoading,
}: {
  mod: CashboxMatchModeration;
  onRefresh: () => void | Promise<void>;
  parentLoading: boolean;
}) {
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function markDone(taskId: string) {
    setActionMsg(null);
    setCompletingId(taskId);
    try {
      const r = await window.api.completeCashboxModerationTask(taskId);
      if (!r.ok) setActionMsg(r.message || 'Could not complete this step');
      else await onRefresh();
    } catch (e) {
      console.error('completeCashboxModerationTask', e);
      setActionMsg('Request failed');
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-600">Check-in &amp; reporting</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void window.api.openExternal(mod.setUrl)}
            className="text-[11px] text-[#21BA45] hover:underline"
          >
            Open match on start.gg
          </button>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={parentLoading || completingId != null}
            className="text-[11px] text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            Refresh tasks
          </button>
        </div>
      </div>
      {mod.hint && <p className="text-xs text-amber-200/80 leading-relaxed">{mod.hint}</p>}
      {actionMsg && <p className="text-xs text-red-400/90">{actionMsg}</p>}
      {mod.tasks.length === 0 ? (
        <p className="text-xs text-gray-500">
          {mod.phaseGroupFetched
            ? 'No checklist steps from start.gg for this set yet.'
            : 'Sign in on start.gg in your browser, copy session cookies into START_GG_WEB_COOKIE if you want steps to appear here.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {mod.tasks.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#252525] bg-black/20 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-200">{t.title}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{t.stateLabel}</p>
              </div>
              {!t.complete ? (
                <button
                  type="button"
                  onClick={() => void markDone(t.id)}
                  disabled={completingId != null}
                  className="shrink-0 rounded-md bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-white/15 disabled:opacity-50"
                >
                  {completingId === t.id ? '…' : 'Mark done'}
                </button>
              ) : (
                <span className="text-[11px] text-[#21BA45]/90 shrink-0">Done</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CHAR_IDS_SORTED = Object.keys(CHARACTER_MAP).map(Number).sort((a, b) => {
  const na = CHARACTER_MAP[a] ?? '';
  const nb = CHARACTER_MAP[b] ?? '';
  return na.localeCompare(nb);
});

function CharPickerGrid({
  selected,
  onSelect,
  label,
  autoOpen = false,
}: {
  selected: number | null;
  onSelect: (id: number | null) => void;
  label: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);

  if (!open) {
    return selected != null ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300"
      >
        <CharacterIcon characterId={selected} size="sm" />
        <span className="text-gray-300">{getCharacterShortName(selected)}</span>
        <span className="text-gray-600 ml-0.5">— tap to change</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/60 transition-colors animate-pulse"
      >
        <span className="text-base leading-none">👆</span>
        <span>Pick your character now</span>
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-gray-600">{label}</p>
      <div className="flex flex-wrap gap-1">
        {CHAR_IDS_SORTED.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => { onSelect(id); setOpen(false); }}
            className={`rounded p-0.5 transition-colors ${
              selected === id
                ? 'bg-[#21BA45]/25 ring-1 ring-[#21BA45]/50'
                : 'hover:bg-white/10'
            }`}
            title={CHARACTER_MAP[id]}
          >
            <CharacterIcon characterId={id} size="sm" />
          </button>
        ))}
        {selected != null && (
          <button
            type="button"
            onClick={() => { onSelect(null); setOpen(false); }}
            className="rounded px-1.5 py-0.5 text-[10px] text-gray-600 hover:text-gray-400"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task-driven set flow (REST task API — synchronized two-player workflow)
// ---------------------------------------------------------------------------

type RawSetTask = {
  id: number;
  entrantId: number;
  siblingId: number;
  setId: number;
  type: number;
  taskOrder: number;
  isCompleted: boolean;
  active: boolean;
  metadata: Record<string, any>;
  updatedAt: number;
  updatedAtMicro: number;
  _raw: Record<string, any>;
};

const TASK_TYPE_LABELS: Record<number, string> = {
  1: 'Check in',
  2: 'Game lobby',
  3: 'Report game',
  4: 'Result verification',
  7: 'Game setup',
};

const STARTGG_STAGE_NAMES: Record<number, string> = {};
for (const s of LEGAL_STAGES) STARTGG_STAGE_NAMES[s.startggId] = s.short;

function stageNameByStartGgId(id: number): string {
  return STARTGG_STAGE_NAMES[id] ?? `Stage ${id}`;
}

function startggCharToSlippi(sggId: number): number | null {
  for (const [slippi, sgg] of Object.entries(SLIPPI_TO_STARTGG_CHAR)) {
    if (sgg === sggId) return Number(slippi);
  }
  return null;
}

function TaskStepIndicator({
  tasks,
  myEntrantId,
}: {
  tasks: RawSetTask[];
  myEntrantId: number;
}) {
  const myTasks = tasks.filter((t) => t.entrantId === myEntrantId);
  const seen = new Set<number>();
  const steps: { order: number; type: number; completed: boolean; active: boolean; label: string }[] = [];
  for (const t of myTasks) {
    if (seen.has(t.taskOrder)) continue;
    seen.add(t.taskOrder);
    const gameNum = typeof t.metadata.gameNum === 'number' ? t.metadata.gameNum : null;
    let label = TASK_TYPE_LABELS[t.type] ?? `Step`;
    if (gameNum != null && (t.type === 7 || t.type === 3)) label += ` ${gameNum}`;
    steps.push({ order: t.taskOrder, type: t.type, completed: t.isCompleted, active: t.active && !t.isCompleted, label });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {steps.map((s) => (
        <span
          key={s.order}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            s.completed
              ? 'bg-[#21BA45]/15 text-[#21BA45]'
              : s.active
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'bg-white/5 text-gray-600'
          }`}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}

function CheckInStep({
  task,
  siblingTask,
  selfLabel,
  oppLabel,
  onAction,
  busy,
}: {
  task: RawSetTask;
  siblingTask: RawSetTask | null;
  selfLabel: string;
  oppLabel: string;
  onAction: () => void;
  busy: boolean;
}) {
  if (task.isCompleted) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">You checked in.</p>
        {siblingTask && !siblingTask.isCompleted && (
          <p className="text-[11px] text-amber-400">Waiting for {oppLabel} to check in…</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-300">Press the button to check in for this match.</p>
      <button
        type="button"
        onClick={onAction}
        disabled={busy}
        className="rounded-md bg-[#21BA45] px-4 py-2 text-sm font-bold text-white hover:bg-[#1ea33e] disabled:opacity-50 transition-colors"
      >
        {busy ? 'Checking in…' : 'Check in'}
      </button>
    </div>
  );
}

function LobbyStep({
  task,
  siblingTask,
  oppLabel,
  opponentConnectCode,
  onAction,
  busy,
}: {
  task: RawSetTask;
  siblingTask: RawSetTask | null;
  oppLabel: string;
  opponentConnectCode: string | null;
  onAction: () => void;
  busy: boolean;
}) {
  const [dcStatus, setDcStatus] = useState<{ status: string; message: string } | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    const unsub = window.api.onDirectConnectStatus((evt: any) => {
      setDcStatus(evt);
      if (evt.status === 'ready' || evt.status === 'error') {
        setLaunching(false);
      }
    });
    return unsub;
  }, []);

  async function handleOpenMelee() {
    const code = opponentConnectCode;
    if (!code) return;
    setLaunching(true);
    setDcStatus({ status: 'configuring', message: `Launching Melee → ${code}…` });
    const result = await window.api.startDirectConnect(code);
    if (result.error) {
      setDcStatus({ status: 'error', message: result.error });
      setLaunching(false);
    } else {
      onAction();
    }
  }

  const meta = task.metadata;
  const room = meta.room != null ? String(meta.room) : null;
  const roomTerm = meta.roomTerm != null ? String(meta.roomTerm) : 'Direct Connect Code';

  if (task.isCompleted) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">Lobby ready{room ? `: ${room}` : ''}.</p>
        {siblingTask && !siblingTask.isCompleted && (
          <p className="text-[11px] text-amber-400">Waiting for {oppLabel}…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-300">
        Connect to your opponent using their {roomTerm}.
      </p>
      {room && (
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-white font-mono">{room}</span>
        </div>
      )}
      {dcStatus && (
        <p className={`text-[11px] ${dcStatus.status === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
          {dcStatus.message}
        </p>
      )}
      {opponentConnectCode ? (
        <button
          type="button"
          onClick={handleOpenMelee}
          disabled={busy || launching}
          className="rounded-md bg-[#7c3aed] px-4 py-2 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {launching ? 'Launching…' : `Open Melee → ${opponentConnectCode}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {busy ? '…' : 'Done'}
        </button>
      )}
    </div>
  );
}

function GameSetupStep({
  task,
  siblingTask,
  selfEntrantId,
  selfLabel,
  oppLabel,
  oppEntrantId,
  onUpdate,
  busy,
  defaultSelfChar,
  localCharPicked,
  onCharPreSelect,
  actionError,
}: {
  task: RawSetTask;
  siblingTask: RawSetTask | null;
  selfEntrantId: number;
  selfLabel: string;
  oppLabel: string;
  oppEntrantId: number | null;
  onUpdate: (body: Record<string, any>) => void;
  busy: boolean;
  defaultSelfChar?: number | null;
  localCharPicked?: boolean;
  onCharPreSelect?: (id: number | null) => void;
  actionError?: string | null;
}) {
  const meta = task.metadata;
  const gameNum = typeof meta.gameNum === 'number' ? meta.gameNum : '?';

  const charSelections = (meta.charSelections ?? {}) as Record<string, number[]>;
  const myChars = charSelections[String(selfEntrantId)] ?? [];
  const oppChars = oppEntrantId ? (charSelections[String(oppEntrantId)] ?? []) : [];
  const myCharPicked = myChars.length > 0 || !!localCharPicked;
  const oppCharPicked = oppChars.length > 0;

  const strikeStages = (meta.strikeStages ?? []) as number[];
  const inStrikePhase = strikeStages.length > 0;
  const strikeList = (meta.strikeList ?? {}) as Record<string, number>;
  const strikeCurrent = typeof meta.strikeCurrent === 'number' ? meta.strikeCurrent : 0;
  const strikeOrder = (meta.strikeOrder ?? []) as number[];
  const neededThisTurn = strikeOrder[strikeCurrent] ?? 1;
  const turn = (meta.turn ?? {}) as Record<string, boolean>;
  const isMyTurn = !!turn[String(selfEntrantId)];
  const isOppTurn = oppEntrantId ? !!turn[String(oppEntrantId)] : false;

  const struckIds = new Set(Object.keys(strikeList).map(Number));
  const availableStages = strikeStages.filter((id) => !struckIds.has(id));

  const [selectedChar, setSelectedCharRaw] = useState<number | null>(() => {
    if (myCharPicked) return startggCharToSlippi(myChars[0]);
    return defaultSelfChar ?? null;
  });
  const setSelectedChar = (id: number | null) => {
    setSelectedCharRaw(id);
    onCharPreSelect?.(id);
    if (charConfirmDismissed) setCharConfirmDismissed(false);
  };
  const [selectedStrikes, setSelectedStrikes] = useState<number[]>([]);
  const [charConfirmDismissed, setCharConfirmDismissed] = useState(false);
  const prevConfirmTaskId = useRef(task.id);
  if (task.id !== prevConfirmTaskId.current) {
    prevConfirmTaskId.current = task.id;
    if (charConfirmDismissed) setCharConfirmDismissed(false);
  }

  const action = (task._raw.action as string) ?? '';
  const isCharAction = action === 'setup_blind' || action === 'setup_character';
  const showCharConfirm = !myCharPicked && selectedChar != null && !charConfirmDismissed && (isMyTurn || isCharAction);

  const prevLogRef = useRef('');
  const logKey = `${task.id}:${action}:${isMyTurn}:${myCharPicked}:${selectedChar}:${showCharConfirm}`;
  if (logKey !== prevLogRef.current) {
    prevLogRef.current = logKey;
    console.log(`[cashbox char] task=${task.id} action=${action} isMyTurn=${isMyTurn} isCharAction=${isCharAction} myCharPicked=${myCharPicked} selectedChar=${selectedChar} showCharConfirm=${showCharConfirm}`);
  }

  useEffect(() => {
    setSelectedStrikes([]);
  }, [strikeCurrent, task.id]);

  if (task.isCompleted) {
    const selectedStageId = typeof meta.stageSelection === 'number' ? (meta.stageSelection as number) : null;
    const remaining = availableStages.length === 1 ? availableStages[0] : selectedStageId;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Game {gameNum} setup complete.</span>
          {remaining != null && (
            <span className="text-white font-medium">Stage: {stageNameByStartGgId(remaining)}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          {myChars[0] != null && (
            <>
              <span>{selfLabel}:</span>
              <CharacterIcon characterId={startggCharToSlippi(myChars[0]) ?? 0} size="sm" />
            </>
          )}
          {oppChars[0] != null && (
            <>
              <span className="text-gray-600 mx-1">vs</span>
              <span>{oppLabel}:</span>
              <CharacterIcon characterId={startggCharToSlippi(oppChars[0]) ?? 0} size="sm" />
            </>
          )}
        </div>
      </div>
    );
  }

  function submitCharacter() {
    if (selectedChar == null || busy) return;
    const sggCharId = SLIPPI_TO_STARTGG_CHAR[selectedChar];
    console.log(`[cashbox char] submit: slippi=${selectedChar} sgg=${sggCharId} taskId=${task.id} action=${action}`);
    if (sggCharId == null) {
      console.error(`[cashbox char] no start.gg mapping for slippi char ${selectedChar}`);
      return;
    }
    const body = { ...task._raw };
    body.metadata = {
      ...meta,
      selection: { 0: sggCharId },
    };
    onUpdate(body);
  }

  function submitStrikes() {
    if (selectedStrikes.length !== neededThisTurn || busy) return;
    const body = { ...task._raw };
    body.metadata = {
      ...meta,
      selection: selectedStrikes,
    };
    onUpdate(body);
  }

  function toggleStrike(stageId: number) {
    setSelectedStrikes((prev) => {
      if (prev.includes(stageId)) return prev.filter((x) => x !== stageId);
      if (prev.length >= neededThisTurn) return [...prev.slice(1), stageId];
      return [...prev, stageId];
    });
  }

  const banStages = (meta.banStages ?? []) as number[];
  const banList = Array.isArray(meta.banList) ? meta.banList as number[] : [];
  const bannedIds = new Set(banList.map(Number));
  const availableBanStages = banStages.filter((id) => !bannedIds.has(id));

  const [selectedBan, setSelectedBan] = useState<number | null>(null);
  const [selectedPickStage, setSelectedPickStage] = useState<number | null>(null);

  function submitBan() {
    if (selectedBan == null || busy) return;
    const body = { ...task._raw };
    body.metadata = { ...meta, selection: [selectedBan] };
    onUpdate(body);
  }

  function submitPickStage() {
    if (selectedPickStage == null || busy) return;
    const body = { ...task._raw };
    body.metadata = { ...meta, selection: [selectedPickStage] };
    onUpdate(body);
  }

  if (showCharConfirm && selectedChar != null) {
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Character select</p>
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-3">
          <p className="text-xs text-gray-300">Lock in this character?</p>
          <div className="flex items-center gap-2">
            <CharacterIcon characterId={selectedChar} size="sm" />
            <span className="text-sm font-medium text-white">{getCharacterShortName(selectedChar)}</span>
          </div>
          {actionError && <p className="text-xs text-red-400/90">{actionError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submitCharacter()}
              disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Submitting…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setCharConfirmDismissed(true)}
              disabled={busy}
              className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
            >
              Change
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (action === 'setup_ban') {
    if (!isMyTurn) {
      return (
        <div className="space-y-2.5">
          <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Stage ban</p>
          <p className="text-xs text-amber-400">Waiting for {oppLabel} to ban a stage…</p>
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-gray-500">Pre-select your character while waiting:</p>
            <CharPickerGrid
              selected={selectedChar}
              onSelect={setSelectedChar}
              label="Your character"
            />
            {selectedChar != null && !myCharPicked && (
              <button type="button" onClick={submitCharacter} disabled={busy}
                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
                {busy ? 'Submitting…' : `Lock in ${getCharacterShortName(selectedChar)}`}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Ban a stage</p>
        <p className="text-xs text-white">Ban <span className="font-bold text-amber-400">1</span> stage.</p>
        <div className="flex flex-wrap gap-1.5">
          {availableBanStages.map((sid) => (
            <button
              key={sid}
              type="button"
              disabled={busy}
              onClick={() => setSelectedBan(sid)}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                selectedBan === sid
                  ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {stageNameByStartGgId(sid)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={submitBan}
          disabled={busy || selectedBan == null}
          className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
        >
          {busy ? '…' : `Ban ${selectedBan != null ? stageNameByStartGgId(selectedBan) : '…'}`}
        </button>
      </div>
    );
  }

  const stageSelection = typeof meta.stageSelection === 'number' ? meta.stageSelection : null;
  const availableCounterpickStages = banStages.filter((id) => !bannedIds.has(id));
  const isCounterpickStageStep =
    action === 'setup_stage' ||
    action === 'setup_counterpick' ||
    action === 'setup_pick' ||
    (banStages.length > 0 && banList.length > 0 && !inStrikePhase && stageSelection == null);

  if (isCounterpickStageStep) {
    if (!isMyTurn && isOppTurn) {
      return (
        <div className="space-y-2.5">
          <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Counterpick stage</p>
          <p className="text-xs text-amber-400">Waiting for {oppLabel} to choose a stage…</p>
          <div className="flex flex-wrap gap-1.5">
            {availableCounterpickStages.map((sid) => (
              <span
                key={sid}
                className="rounded-md px-2.5 py-1.5 text-[11px] font-medium bg-white/5 text-gray-300"
              >
                {stageNameByStartGgId(sid)}
              </span>
            ))}
          </div>
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-gray-500">Pre-select your character while waiting:</p>
            <CharPickerGrid
              selected={selectedChar}
              onSelect={setSelectedChar}
              label="Your character"
            />
            {selectedChar != null && !myCharPicked && (
              <button type="button" onClick={submitCharacter} disabled={busy}
                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
                {busy ? 'Submitting…' : `Lock in ${getCharacterShortName(selectedChar)}`}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Pick a stage</p>
        {!isMyTurn && !isOppTurn && (
          <p className="text-[11px] text-amber-400">
            Turn info is stale. You can still pick here to unblock Game {gameNum}.
          </p>
        )}
        <p className="text-xs text-white">Choose your counterpick stage.</p>
        <div className="flex flex-wrap gap-1.5">
          {availableCounterpickStages.map((sid) => (
            <button
              key={sid}
              type="button"
              disabled={busy}
              onClick={() => setSelectedPickStage(sid)}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                selectedPickStage === sid
                  ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {stageNameByStartGgId(sid)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={submitPickStage}
          disabled={busy || selectedPickStage == null}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {busy ? '…' : `Pick ${selectedPickStage != null ? stageNameByStartGgId(selectedPickStage) : '…'}`}
        </button>
      </div>
    );
  }

  if (action === 'setup_blind' || action === 'setup_character') {
    if (!isMyTurn && !myCharPicked) {
      return (
        <div className="space-y-2.5">
          <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Character select</p>
          {stageSelection != null && (
            <p className="text-xs text-gray-400">Stage: <span className="text-white font-medium">{stageNameByStartGgId(stageSelection)}</span></p>
          )}
          <p className="text-xs text-amber-400">Waiting for {oppLabel} to complete their action…</p>
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-gray-500">Pre-select your character while waiting:</p>
            <CharPickerGrid
              selected={selectedChar}
              onSelect={setSelectedChar}
              label="Your character"
            />
            {selectedChar != null && (
              <button type="button" onClick={submitCharacter} disabled={busy}
                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
                {busy ? 'Submitting…' : `Lock in ${getCharacterShortName(selectedChar)}`}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Pick your character</p>
        {stageSelection != null && (
          <p className="text-xs text-gray-400">Stage: <span className="text-white font-medium">{stageNameByStartGgId(stageSelection)}</span></p>
        )}
        {myCharPicked ? (
          <div className="space-y-1">
            {myChars[0] != null ? (
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <span>Your pick:</span>
                <CharacterIcon characterId={startggCharToSlippi(myChars[0]) ?? 0} size="sm" />
                <span>{getCharacterShortName(startggCharToSlippi(myChars[0]) ?? 0)}</span>
              </div>
            ) : selectedChar != null ? (
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <span>Your pick:</span>
                <CharacterIcon characterId={selectedChar} size="sm" />
                <span>{getCharacterShortName(selectedChar)}</span>
              </div>
            ) : (
              <p className="text-xs text-gray-300">Character locked in.</p>
            )}
            {!oppCharPicked && (
              <p className="text-[11px] text-amber-400">Waiting for {oppLabel} to pick…</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <CharPickerGrid
              selected={selectedChar}
              onSelect={setSelectedChar}
              label="Your character"
              autoOpen
            />
            <button
              type="button"
              onClick={submitCharacter}
              disabled={busy || selectedChar == null}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {busy ? '…' : 'Lock in character'}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!inStrikePhase) {
    if (!isMyTurn) {
      return (
        <div className="space-y-2.5">
          <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Setup</p>
          <p className="text-xs text-amber-400">Waiting for {oppLabel} to complete their step…</p>
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-gray-500">Pre-select your character while waiting:</p>
            <CharPickerGrid
              selected={selectedChar}
              onSelect={setSelectedChar}
              label="Your character"
            />
            {selectedChar != null && !myCharPicked && (
              <button type="button" onClick={submitCharacter} disabled={busy}
                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
                {busy ? 'Submitting…' : `Lock in ${getCharacterShortName(selectedChar)}`}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] text-gray-500 font-medium">Game {gameNum} — Setup</p>
        <p className="text-xs text-amber-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-gray-500 font-medium">
        Game {gameNum} — Stage striking
      </p>
      <div className="flex items-center gap-3 text-[11px]">
        {myChars[0] != null && (
          <span className="flex items-center gap-1 text-gray-400">
            {selfLabel}: <CharacterIcon characterId={startggCharToSlippi(myChars[0]) ?? 0} size="sm" />
          </span>
        )}
        {oppChars[0] != null && (
          <span className="flex items-center gap-1 text-gray-400">
            {oppLabel}: <CharacterIcon characterId={startggCharToSlippi(oppChars[0]) ?? 0} size="sm" />
          </span>
        )}
      </div>

      {struckIds.size > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-600">Struck stages</p>
          <div className="flex flex-wrap gap-1.5">
            {strikeStages.filter((sid) => struckIds.has(sid)).map((sid) => {
              const strikerEntrant = Number(strikeList[String(sid)]);
              const isSelf = strikerEntrant === selfEntrantId;
              return (
                <span
                  key={sid}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium line-through ${
                    isSelf
                      ? 'bg-red-500/10 text-red-400/60'
                      : 'bg-blue-500/10 text-blue-400/60'
                  }`}
                >
                  {stageNameByStartGgId(sid)}
                  <span className="ml-1 no-underline text-[10px] opacity-70">
                    {isSelf ? '(you)' : `(${oppLabel})`}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {isMyTurn ? (
        <div className="space-y-2">
          <p className="text-xs text-white">
            Strike <span className="font-bold text-amber-400">{neededThisTurn}</span> stage{neededThisTurn > 1 ? 's' : ''}.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableStages.map((sid) => {
              const picked = selectedStrikes.includes(sid);
              return (
                <button
                  key={sid}
                  type="button"
                  disabled={busy}
                  onClick={() => toggleStrike(sid)}
                  className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    picked
                      ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40'
                      : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {stageNameByStartGgId(sid)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={submitStrikes}
            disabled={busy || selectedStrikes.length !== neededThisTurn}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
          >
            {busy ? '…' : `Strike ${selectedStrikes.map((s) => stageNameByStartGgId(s)).join(', ') || '…'}`}
          </button>
        </div>
      ) : isOppTurn ? (
        <div className="space-y-1">
          <p className="text-xs text-amber-400">
            Waiting for {oppLabel} to strike {neededThisTurn} stage{neededThisTurn > 1 ? 's' : ''}…
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableStages.map((sid) => (
              <span
                key={sid}
                className="rounded-md px-2.5 py-1.5 text-[11px] font-medium bg-white/5 text-gray-300"
              >
                {stageNameByStartGgId(sid)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Waiting for strike phase to advance…</p>
      )}
    </div>
  );
}

function ReportGameStep({
  task,
  siblingTask,
  selfEntrantId,
  selfLabel,
  oppLabel,
  oppEntrantId,
  onAction,
  onClearReport,
  busy,
  submittedWinnerId,
}: {
  task: RawSetTask;
  siblingTask: RawSetTask | null;
  selfEntrantId: number;
  selfLabel: string;
  oppLabel: string;
  oppEntrantId: number | null;
  onAction: (winnerId: number) => void;
  onClearReport: () => void;
  busy: boolean;
  submittedWinnerId?: number | null;
}) {
  const meta = task.metadata;
  const gameNum = typeof meta.gameNum === 'number' ? meta.gameNum : '?';
  const [selectedWinner, setSelectedWinner] = useState<number | null>(null);

  const alreadyReported = submittedWinnerId != null;
  const reportedName = alreadyReported
    ? (submittedWinnerId === selfEntrantId ? selfLabel : oppLabel)
    : null;

  if (task.isCompleted) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Game {gameNum} reported.</p>
        {siblingTask && !siblingTask.isCompleted && (
          <p className="text-[11px] text-amber-400">Waiting for {oppLabel} to confirm…</p>
        )}
      </div>
    );
  }

  if (alreadyReported) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-gray-500 font-medium">Report game {gameNum} winner</p>
        <div className="rounded-md bg-[#21BA45]/10 border border-[#21BA45]/20 px-3 py-2">
          <p className="text-sm text-[#21BA45]">
            You reported: <span className="font-bold">{reportedName} won</span>
          </p>
          <p className="text-[11px] text-gray-500 mt-1">Waiting for {oppLabel} to confirm…</p>
        </div>
        <button
          type="button"
          onClick={onClearReport}
          className="text-[11px] text-gray-600 hover:text-gray-400"
        >
          Change selection
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500 font-medium">Report game {gameNum} winner</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSelectedWinner(selfEntrantId)}
          disabled={busy}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            selectedWinner === selfEntrantId
              ? 'bg-[#21BA45]/25 border-2 border-[#21BA45] text-[#21BA45]'
              : 'bg-[#21BA45]/10 border border-[#21BA45]/20 text-[#21BA45]/80 hover:bg-[#21BA45]/20'
          }`}
        >
          {selfLabel} won
        </button>
        {oppEntrantId != null && (
          <button
            type="button"
            onClick={() => setSelectedWinner(oppEntrantId)}
            disabled={busy}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              selectedWinner === oppEntrantId
                ? 'bg-white/15 border-2 border-white/40 text-white'
                : 'bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10'
            }`}
          >
            {oppLabel} won
          </button>
        )}
      </div>
      {selectedWinner != null && (
        <button
          type="button"
          onClick={() => onAction(selectedWinner)}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors w-full"
        >
          {busy ? 'Submitting…' : 'Submit result'}
        </button>
      )}
      <p className="text-[10px] text-gray-600">Both players must agree on the result.</p>
    </div>
  );
}

function SetTaskFlow({
  next,
  sggConnected,
  onRefresh,
  defaultSelfChar,
  opponentConnectCodeFallback,
  onOpponentCodeResolved,
  setUrl,
}: {
  next: NextMatch;
  sggConnected: boolean;
  onRefresh: () => void | Promise<void>;
  defaultSelfChar?: number | null;
  opponentConnectCodeFallback?: string | null;
  onOpponentCodeResolved?: (code: string | null) => void;
  setUrl?: string | null;
}) {
  const [tasks, setTasks] = useState<RawSetTask[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submittedReports, setSubmittedReports] = useState<Record<number, number>>({});
  const [submittedSetups, setSubmittedSetups] = useState<Record<number, { charPicked?: boolean; strikesSent?: number }>>({});
  const [preSelectedChar, setPreSelectedChar] = useState<number | null>(null);
  const fetchNowRef = useRef<() => void>(() => {});

  const [webTaskView, setWebTaskView] = useState(true);
  useEffect(() => {
    window.api.getSettings().then((s: any) => {
      if (s?.useWebTaskView === false) setWebTaskView(false);
    });
  }, []);

  const selfId = Number(next.selfEntrantId);
  const oppId = next.opponentEntrantId ? Number(next.opponentEntrantId) : null;
  const selfLabel = next.selfEntrantName || 'You';
  const oppLabel = next.opponentName || 'Opponent';
  const pgId = next.phaseGroupId;
  const lobbyRoomCode = (() => {
    const lobbyTask = tasks.find((t) => t.type === 2);
    const room = lobbyTask?.metadata?.room;
    if (typeof room !== 'string') return null;
    const c = room.trim();
    return c.length > 0 ? c : null;
  })();
  const oppCode = lobbyRoomCode ?? opponentConnectCodeFallback ?? next.slippiConnectCode ?? next.friendlies?.connectCode ?? null;

  useEffect(() => {
    onOpponentCodeResolved?.(oppCode);
  }, [oppCode, onOpponentCodeResolved]);

  const fetchTasks = useCallback(async () => {
    if (!pgId) { setLoadError('No phase group — cannot load tasks.'); return; }
    try {
      const r = await window.api.getSetTasks(pgId, next.setId);
      if (!r.ok) { setLoadError(r.message || 'Failed to load tasks'); return; }
      const incoming = r.tasks ?? [];
      if (incoming.length === 0) { setLoadError(null); return; }
      setTasks((prev) => {
        if (prev.length === 0) return incoming;
        const prevMap = new Map<number, RawSetTask>(prev.map((t) => [t.id, t]));
        const newMap = new Map<number, RawSetTask>(incoming.map((t: RawSetTask) => [t.id, t]));
        let kept = 0;
        let updated = 0;
        for (const [id, nt] of newMap) {
          const existing = prevMap.get(id);
          if (existing && existing.updatedAtMicro > nt.updatedAtMicro) {
            kept++;
            continue;
          }
          if (existing && (existing.isCompleted !== nt.isCompleted || existing.active !== nt.active)) {
            console.log(`[cashbox poll] task ${id} type=${nt.type}: completed=${existing.isCompleted}→${nt.isCompleted} active=${existing.active}→${nt.active} micro=${existing.updatedAtMicro}→${nt.updatedAtMicro}`);
          }
          updated++;
          prevMap.set(id, nt);
        }
        if (newMap.size >= prev.length) {
          for (const id of prevMap.keys()) {
            if (!newMap.has(id)) prevMap.delete(id);
          }
        }
        if (kept > 0) console.log(`[cashbox poll] kept ${kept} local tasks (newer), updated ${updated}`);
        return [...prevMap.values()].sort((a, b) => a.taskOrder - b.taskOrder || a.id - b.id);
      });
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'Request failed');
    }
  }, [pgId, next.setId]);

  const allSetDone = tasks.length > 0 && tasks.every((t) => t.isCompleted);
  const allSetDoneRef = useRef(false);
  useEffect(() => {
    if (allSetDone && !allSetDoneRef.current) {
      allSetDoneRef.current = true;
      console.log('[cashbox] all set tasks complete — triggering snapshot reload');
      void onRefresh();
    } else if (!allSetDone) {
      allSetDoneRef.current = false;
    }
  }, [allSetDone, onRefresh]);

  const myTasksForPoll = tasks.filter((t) => t.entrantId === selfId);
  const myActiveSetup = myTasksForPoll.find((t) => t.type === 7 && t.active && !t.isCompleted);
  const setupWaitingForOpp = myActiveSetup != null && (() => {
    const turn = (myActiveSetup.metadata?.turn ?? {}) as Record<string, boolean>;
    return !turn[String(selfId)];
  })();
  const waitingForOpponent = (tasks.length > 0
    && myTasksForPoll.length > 0
    && myTasksForPoll.every((t) => t.isCompleted)
    && !allSetDone)
    || setupWaitingForOpp;
  const waitingRef = useRef(waitingForOpponent);
  waitingRef.current = waitingForOpponent;

  useEffect(() => {
    let active = true;
    let tid: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      if (!active) return;
      await fetchTasks();
      const interval = waitingRef.current ? 700 : 2500;
      if (active) tid = setTimeout(poll, interval);
    }
    fetchNowRef.current = () => {
      if (tid) clearTimeout(tid);
      tid = null;
      void poll();
    };
    void poll();
    return () => { active = false; if (tid) clearTimeout(tid); };
  }, [fetchTasks]);

  // GraphQL change-detection: polls api.start.gg (different service/cache) for updatedAt
  const lastGqlUpdatedAt = useRef<number>(0);
  useEffect(() => {
    let active = true;
    let tid: ReturnType<typeof setTimeout> | null = null;
    let rateLimitBackoff = 0;
    async function gqlPoll() {
      if (!active) return;
      try {
        const r = await window.api.getSetUpdatedAt(next.setId);
        if (r.ok && r.updatedAt != null) {
          if (lastGqlUpdatedAt.current > 0 && r.updatedAt > lastGqlUpdatedAt.current) {
            console.log(`[cashbox gql] set changed: ${lastGqlUpdatedAt.current} → ${r.updatedAt}`);
            fetchNowRef.current();
          }
          lastGqlUpdatedAt.current = r.updatedAt;
          rateLimitBackoff = 0;
        } else if (!r.ok && String(r.message ?? '').toLowerCase().includes('rate limit')) {
          rateLimitBackoff = Math.min((rateLimitBackoff || 2800) * 2, 20_000);
        }
      } catch {}
      const baseDelay = waitingRef.current ? 1500 : 3500;
      const delayMs = rateLimitBackoff || baseDelay;
      if (active) tid = setTimeout(gqlPoll, delayMs);
    }
    void gqlPoll();
    return () => { active = false; if (tid) clearTimeout(tid); };
  }, [next.setId]);

  const [dcStatus, setDcStatus] = useState<{ status: string; message: string } | null>(null);
  const [launching, setLaunching] = useState(false);
  const prevCurrentRef = useRef<string>('');

  useEffect(() => {
    const unsub = window.api.onDirectConnectStatus((evt: any) => {
      setDcStatus(evt);
      if (evt.status === 'ready' || evt.status === 'error') setLaunching(false);
    });
    return unsub;
  }, []);

  if (!sggConnected) return null;
  if (!pgId) return null;

  const myTasks = tasks.filter((t) => t.entrantId === selfId);
  const activeTask = myTasks.find((t) => !t.isCompleted && t.active);
  const fallbackTask = !activeTask
    ? [...myTasks].filter((t) => !t.isCompleted).sort((a, b) => a.taskOrder - b.taskOrder || a.id - b.id)[0] ?? null
    : null;
  const currentTask = activeTask ?? fallbackTask ?? null;
  const usingFallbackTask = !activeTask && !!fallbackTask;
  const siblingOf = (t: RawSetTask) => tasks.find((x) => x.id === t.siblingId) ?? null;
  const taskKey = currentTask ? `${currentTask.id}:${currentTask.type}:${currentTask.isCompleted}` : 'none';
  if (taskKey !== prevCurrentRef.current) {
    console.log(`[cashbox ui] currentTask → ${currentTask ? `id=${currentTask.id} type=${TASK_TYPE_LABELS[currentTask.type] ?? currentTask.type} action=${(currentTask._raw as any)?.action ?? '?'} completed=${currentTask.isCompleted} micro=${currentTask.updatedAtMicro}` : '(none)'}`);
    prevCurrentRef.current = taskKey;
  }

  function applyResponseTasks(newTasks?: RawSetTask[]) {
    if (newTasks && newTasks.length > 0) {
      setTasks((prev) => {
        const map = new Map(prev.map((t) => [t.id, t]));
        for (const t of newTasks) {
          const existing = map.get(t.id);
          if (existing) {
            if (existing.isCompleted && !t.isCompleted) continue;
            const existingTs = existing.updatedAtMicro ?? existing.updatedAt ?? 0;
            const incomingTs = t.updatedAtMicro ?? t.updatedAt ?? 0;
            if (existingTs > incomingTs) continue;
          }
          map.set(t.id, t);
        }
        return [...map.values()].sort((a, b) => a.taskOrder - b.taskOrder || a.id - b.id);
      });
    }
  }

  function markTaskDoneLocally(taskId: number) {
    const optimisticMicro = Date.now() / 1000 + 9999999;
    setTasks((prev) => {
      const completedOrder = prev.find((x) => x.id === taskId)?.taskOrder ?? 0;
      const nextPending = prev
        .filter((x) => x.entrantId === selfId && !x.isCompleted && x.id !== taskId && x.taskOrder > completedOrder)
        .sort((a, b) => a.taskOrder - b.taskOrder)[0];
      const updated = prev.map((t) => {
        if (t.id === taskId) return { ...t, isCompleted: true, active: false, updatedAtMicro: optimisticMicro };
        if (nextPending && t.id === nextPending.id) return { ...t, active: true, updatedAtMicro: optimisticMicro };
        return t;
      });
      return updated;
    });
  }

  function isStaleStateError(message?: string): boolean {
    if (!message) return false;
    const m = message.toLowerCase();
    return m.includes('already complete')
      || m.includes('already been striked')
      || m.includes('already been struck')
      || m.includes('out of date')
      || m.includes('not your turn');
  }

  function scheduleRefresh(delayMs = 500) {
    setTimeout(() => fetchNowRef.current(), delayMs);
  }

  function burstRefresh() {
    const delays = [0, 250, 500, 1000, 1600];
    for (const d of delays) {
      setTimeout(() => fetchNowRef.current(), d);
    }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForTaskConvergence(taskId: number): Promise<void> {
    for (let i = 0; i < 8; i++) {
      if (i > 0) await sleep(180 + i * 120);
      try {
        const freshResult = await window.api.getSetTasks(pgId!, next.setId, true);
        if (!freshResult.ok || !freshResult.tasks) continue;
        applyResponseTasks(freshResult.tasks);
        const task = freshResult.tasks.find((t: RawSetTask) => t.id === taskId);
        const activeMine = freshResult.tasks
          .filter((t: RawSetTask) => t.entrantId === selfId && !t.isCompleted && t.active)
          .sort((a: RawSetTask, b: RawSetTask) => a.taskOrder - b.taskOrder)[0];
        if (!task || task.isCompleted || (activeMine && activeMine.id !== taskId)) return;
      } catch {
        // Best-effort convergence probe; keep trying.
      }
    }
  }

  const AUTO_ADVANCE_TYPES = new Set([2]);

  function tryAutoAdvance(completedTask: RawSetTask, responseTasks?: RawSetTask[]) {
    const allTasks = responseTasks && responseTasks.length > 0 ? responseTasks : tasks;
    const nextPending = allTasks
      .filter((t: RawSetTask) => t.entrantId === selfId && !t.isCompleted && t.id !== completedTask.id && t.taskOrder > completedTask.taskOrder)
      .sort((a: RawSetTask, b: RawSetTask) => a.taskOrder - b.taskOrder)[0];
    if (nextPending && AUTO_ADVANCE_TYPES.has(nextPending.type)) {
      console.log(`[cashbox] auto-advancing past ${TASK_TYPE_LABELS[nextPending.type] ?? nextPending.type}`, nextPending.id);
      markTaskDoneLocally(nextPending.id);
      setTimeout(() => void handleComplete(nextPending), 150);
      return true;
    }
    return false;
  }

  async function handleComplete(task: RawSetTask) {
    setBusy(true);
    setActionError(null);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let raw = task._raw;
        if (attempt > 0) {
          try {
            const freshResult = await window.api.getSetTasks(pgId!, next.setId, true);
            if (freshResult.ok && freshResult.tasks) {
              applyResponseTasks(freshResult.tasks);
              const freshTask = freshResult.tasks.find((t: RawSetTask) => t.id === task.id);
              if (freshTask) raw = freshTask._raw;
            }
          } catch {}
        }
        const r = await window.api.taskComplete(String(task.id), raw);
        if (!r.ok) {
          const stale = isStaleStateError(r.message);
          if (stale && attempt < 2) {
            await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
            continue;
          }
          if (stale) {
            markTaskDoneLocally(task.id);
            scheduleRefresh(300);
          } else {
            setActionError(r.message || 'Failed');
          }
          return;
        }
        markTaskDoneLocally(task.id);
        applyResponseTasks(r.tasks);
        if (task.type === 4) {
          scheduleRefresh();
          setTimeout(() => void onRefresh(), 2000);
        } else {
          tryAutoAdvance(task, r.tasks);
          burstRefresh();
        }
        await waitForTaskConvergence(task.id);
        return;
      }
    } catch (e: any) {
      setActionError(e?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(body: Record<string, any>) {
    const taskId = body.id;
    if (taskId == null) return;
    const selection = body.metadata?.selection;
    console.log(`[cashbox action] handleUpdate task=${taskId} selection=${JSON.stringify(selection)}`);
    setBusy(true);
    setActionError(null);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let mergedBody = body;
        try {
          const freshResult = await window.api.getSetTasks(pgId!, next.setId, true);
          if (freshResult.ok && freshResult.tasks) {
            applyResponseTasks(freshResult.tasks);
            const freshTask = freshResult.tasks.find((t: RawSetTask) => t.id === Number(taskId));
            if (freshTask) {
              mergedBody = { ...freshTask._raw };
              if (selection !== undefined) {
                mergedBody.metadata = { ...(mergedBody.metadata as Record<string, any> ?? {}), selection };
              }
            }
          }
        } catch {}

        const microSent = mergedBody.updatedAtMicro ?? mergedBody.updatedAt ?? '?';
        console.log(`[cashbox action] PUT update task=${taskId} attempt=${attempt} micro=${microSent}`);
        const r = await window.api.taskUpdate(String(taskId), mergedBody);
        console.log(`[cashbox action] update result ok=${r.ok} msg=${r.message ?? ''} tasks=${r.tasks?.length ?? 0}`);
        if (!r.ok) {
          const stale = isStaleStateError(r.message);
          if (stale && attempt < 2) {
            await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
            continue;
          }
          if (stale) {
            if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
              setSubmittedSetups((prev) => ({ ...prev, [taskId]: { ...prev[taskId], charPicked: true } }));
            }
            scheduleRefresh(300);
          } else {
            setActionError(r.message || 'Failed');
          }
          return;
        }
        if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
          setSubmittedSetups((prev) => ({ ...prev, [taskId]: { ...prev[taskId], charPicked: true } }));
        } else if (Array.isArray(selection)) {
          setSubmittedSetups((prev) => ({
            ...prev,
            [taskId]: { ...prev[taskId], strikesSent: (prev[taskId]?.strikesSent ?? 0) + selection.length },
          }));
        }
        applyResponseTasks(r.tasks);
        const returnedTask = r.tasks?.find((t: RawSetTask) => t.id === Number(taskId));
        if (returnedTask?.isCompleted) {
          markTaskDoneLocally(Number(taskId));
          tryAutoAdvance(returnedTask, r.tasks);
        }
        burstRefresh();
        await waitForTaskConvergence(Number(taskId));
        return;
      }
    } catch (e: any) {
      setActionError(e?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleReportWinner(task: RawSetTask, winnerId: number) {
    setBusy(true);
    setActionError(null);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let freshRaw = task._raw;
        try {
          const freshResult = await window.api.getSetTasks(pgId!, next.setId, true);
          if (freshResult.ok && freshResult.tasks) {
            applyResponseTasks(freshResult.tasks);
            const freshTask = freshResult.tasks.find((t: RawSetTask) => t.id === task.id);
            if (freshTask) freshRaw = freshTask._raw;
          }
        } catch {}

        const body = { ...freshRaw };
        const meta = { ...(body.metadata as Record<string, any> ?? {}) };
        const report = { ...(meta.report ?? {}) };
        report.winnerId = winnerId;
        meta.report = report;
        body.metadata = meta;
        const r = await window.api.taskComplete(String(task.id), body);
        if (!r.ok) {
          const stale = isStaleStateError(r.message);
          if (stale && attempt < 2) {
            await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
            continue;
          }
          if (stale) {
            setActionError('Result changed on start.gg. Please pick winner again or verify/dispute below.');
            scheduleRefresh(300);
          } else {
            setActionError(r.message || 'Failed');
          }
          return;
        }
        setSubmittedReports((prev) => ({ ...prev, [task.id]: winnerId }));
        const returnedTask = r.tasks?.find((t: RawSetTask) => t.id === task.id);
        if (returnedTask?.isCompleted) {
          markTaskDoneLocally(task.id);
          tryAutoAdvance(task, r.tasks);
        }
        applyResponseTasks(r.tasks);
        burstRefresh();
        await waitForTaskConvergence(task.id);
        return;
      }
    } catch (e: any) {
      setActionError(e?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  if (loadError && tasks.length === 0) {
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-600">Match tasks</p>
        <p className="text-xs text-red-400/90">{loadError}</p>
        <button
          type="button"
          onClick={() => void fetchTasks()}
          className="text-[11px] text-gray-500 hover:text-gray-300"
        >
          Retry
        </button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-3">
        <p className="text-[10px] uppercase tracking-wider text-gray-600">Match tasks</p>
        <p className="text-xs text-gray-500 mt-1">Loading tasks…</p>
      </div>
    );
  }

  const allMyDone = myTasks.length > 0 && myTasks.every((t) => t.isCompleted);
  const checkInDone = myTasks.some((t) => t.type === 1 && t.isCompleted);
  const latestReportTask = [...myTasks]
    .filter((t) => t.type === 3)
    .sort((a, b) => b.taskOrder - a.taskOrder)[0] ?? null;

  async function handleLaunchMelee() {
    if (!oppCode) return;
    setLaunching(true);
    setDcStatus({ status: 'configuring', message: `Launching Melee → ${oppCode}…` });
    const result = await window.api.startDirectConnect(oppCode);
    if (result.error) {
      setDcStatus({ status: 'error', message: result.error });
      setLaunching(false);
    }
  }

  function toggleWebTaskView() {
    const next = !webTaskView;
    setWebTaskView(next);
    window.api.updateSettings({ useWebTaskView: next });
  }

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-600">Match tasks</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleWebTaskView}
            className={`text-[11px] transition-colors ${webTaskView ? 'text-[#21BA45]' : 'text-gray-600 hover:text-gray-400'}`}
            title={webTaskView ? 'Switch to native task view' : 'Switch to start.gg browser view'}
          >
            {webTaskView ? 'Native view' : 'Browser view'}
          </button>
          {!webTaskView && (
            <button
              type="button"
              onClick={() => fetchNowRef.current()}
              disabled={busy}
              className="text-[11px] text-gray-600 hover:text-gray-400 disabled:opacity-50"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      {webTaskView ? (
        setUrl ? (
          <div className="space-y-2">
            <webview
              src={setUrl}
              partition="persist:startgg"
              style={{ width: '100%', height: '520px', borderRadius: '6px', border: '1px solid #252525' }}
              ref={(el: any) => {
                if (!el) return;
                if (el._scrollBound) return;
                el._scrollBound = true;
                el.addEventListener('did-finish-load', () => {
                  el.executeJavaScript(`
                    (function() {
                      var el = document.querySelector('[class*="tasks"], [class*="moderation"], [class*="SetModeration"]');
                      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                      else { window.scrollBy(0, 450); }
                    })();
                  `);
                });
              }}
            />
          </div>
        ) : (
          <p className="text-xs text-gray-500">Waiting for set URL to load…</p>
        )
      ) : (
        <>

      {setUrl && (
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Having issues with native-view? You can manage your set tasks directly in the Browser view!
        </p>
      )}

      <TaskStepIndicator tasks={tasks} myEntrantId={selfId} />

      {actionError && <p className="text-xs text-red-400/90">{actionError}</p>}
      {loadError && <p className="text-xs text-amber-200/80">{loadError}</p>}
      {usingFallbackTask && (
        <p className="text-[11px] text-amber-300/90">
          Task state was stale; showing next pending step to avoid lock.
        </p>
      )}

      {allMyDone ? (
        <p className="text-sm text-[#21BA45]">All tasks complete for this set.</p>
      ) : currentTask ? (
        <div className="rounded-md border border-[#252525] bg-black/30 px-2.5 py-2.5">
          {currentTask.type === 1 && (
            <CheckInStep
              task={currentTask}
              siblingTask={siblingOf(currentTask)}
              selfLabel={selfLabel}
              oppLabel={oppLabel}
              onAction={() => void handleComplete(currentTask)}
              busy={busy}
            />
          )}
          {currentTask.type === 2 && (
            <LobbyStep
              task={currentTask}
              siblingTask={siblingOf(currentTask)}
              oppLabel={oppLabel}
              opponentConnectCode={oppCode}
              onAction={() => void handleComplete(currentTask)}
              busy={busy}
            />
          )}
          {currentTask.type === 7 && (
            <GameSetupStep
              key={currentTask.id}
              task={currentTask}
              siblingTask={siblingOf(currentTask)}
              selfEntrantId={selfId}
              selfLabel={selfLabel}
              oppLabel={oppLabel}
              oppEntrantId={oppId}
              onUpdate={handleUpdate}
              busy={busy}
              defaultSelfChar={preSelectedChar ?? defaultSelfChar}
              localCharPicked={!!submittedSetups[currentTask.id]?.charPicked}
              onCharPreSelect={setPreSelectedChar}
              actionError={actionError}
            />
          )}
          {currentTask.type === 3 && (
            <ReportGameStep
              task={currentTask}
              siblingTask={siblingOf(currentTask)}
              selfEntrantId={selfId}
              selfLabel={selfLabel}
              oppLabel={oppLabel}
              oppEntrantId={oppId}
              onAction={(winnerId) => void handleReportWinner(currentTask, winnerId)}
              onClearReport={() => setSubmittedReports((prev) => {
                const next = { ...prev };
                delete next[currentTask.id];
                return next;
              })}
              busy={busy}
              submittedWinnerId={submittedReports[currentTask.id] ?? null}
            />
          )}
          {currentTask.type === 4 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-300">Result verification</p>
              <button
                type="button"
                onClick={() => void handleComplete(currentTask)}
                disabled={busy}
                className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50 transition-colors"
              >
                {busy ? '…' : 'Confirm result'}
              </button>
              {latestReportTask && oppId != null && (
                <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 space-y-2">
                  <p className="text-[11px] text-amber-300">Wrong winner selected? Re-submit before confirming.</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleReportWinner(latestReportTask, selfId)}
                      disabled={busy}
                      className="flex-1 rounded-md bg-[#21BA45]/20 border border-[#21BA45]/40 px-2 py-1.5 text-[11px] font-medium text-[#21BA45] hover:bg-[#21BA45]/30 disabled:opacity-50"
                    >
                      {selfLabel} won
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReportWinner(latestReportTask, oppId)}
                      disabled={busy}
                      className="flex-1 rounded-md bg-white/10 border border-white/20 px-2 py-1.5 text-[11px] font-medium text-gray-200 hover:bg-white/15 disabled:opacity-50"
                    >
                      {oppLabel} won
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {![1, 2, 3, 4, 7].includes(currentTask.type) && (
            <div className="space-y-2">
              <p className="text-xs text-gray-300">
                {TASK_TYPE_LABELS[currentTask.type] ?? `Task type ${currentTask.type}`}
              </p>
              <button
                type="button"
                onClick={() => void handleComplete(currentTask)}
                disabled={busy}
                className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50 transition-colors"
              >
                {busy ? '…' : 'Mark done'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-amber-400">Waiting for {oppLabel} to complete their step…</p>
          {myTasks.some((t) => t.type === 7 && !t.isCompleted) && (
            <div className="rounded-md border border-[#252525] bg-black/20 px-2.5 py-2.5 space-y-2">
              <p className="text-[11px] text-gray-500">Pre-select your character while waiting</p>
              <CharPickerGrid
                selected={preSelectedChar}
                onSelect={setPreSelectedChar}
                label="Your character"
              />
            </div>
          )}
        </div>
      )}

        </>
      )}
    </div>
  );
}

type BracketSet = Extract<Snapshot, { ok: true }>['bracketSets'][number];

function CashboxNativeBracket({
  sets,
  entrantName,
  bracketUrl,
  overviewUrl,
}: {
  sets: BracketSet[];
  entrantName: string;
  bracketUrl: string;
  overviewUrl: string;
}) {
  const pending = sets.filter((s) => s.state === 'pending');
  const done = [...sets.filter((s) => s.state === 'complete')].reverse();

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111] overflow-hidden flex flex-col max-h-[min(520px,58vh)]">
      <div className="px-4 py-2.5 border-b border-[#2a2a2a] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Your bracket run</span>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void window.api.openExternal(bracketUrl)}
            className="text-[11px] text-[#21BA45] hover:underline"
          >
            start.gg brackets
          </button>
          <button
            type="button"
            onClick={() => void window.api.openExternal(overviewUrl)}
            className="text-[11px] text-gray-500 hover:text-gray-300"
          >
            Overview
          </button>
        </div>
      </div>
      <div className="overflow-y-auto px-3 py-3 space-y-5 min-h-[200px]">
        {sets.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No sets reported for this event yet.</p>
        ) : (
          <>
            {pending.length > 0 && (
              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/85 mb-2 px-0.5">
                  Upcoming
                </h3>
                <ul className="space-y-2">
                  {pending.map((s) => (
                    <li
                      key={s.setId}
                      className="rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/[0.07] to-transparent px-3 py-2.5"
                    >
                      <p className="text-[11px] text-gray-500">{s.roundText}</p>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-1.5 text-sm">
                        <span className="text-white font-medium truncate max-w-[45%]">{entrantName}</span>
                        <span className="text-gray-600 text-xs">vs</span>
                        <span className="text-gray-200 truncate max-w-[45%]">{s.opponentName ?? 'TBD'}</span>
                      </div>
                      {s.scoreDisplay && (
                        <p className="text-[11px] text-gray-500 font-mono mt-1">{s.scoreDisplay}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2 px-0.5">
                Completed
              </h3>
              {done.length === 0 ? (
                <p className="text-xs text-gray-600 py-2 px-0.5">No finished sets yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {done.map((s) => (
                    <li
                      key={s.setId}
                      className="rounded-md border border-[#2a2a2a] bg-[#0c0c0c] px-3 py-2 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-gray-500">{s.roundText}</p>
                        <p className="text-sm text-gray-200 mt-0.5 truncate">
                          vs <span className="text-gray-300">{s.opponentName ?? '—'}</span>
                          {s.scoreDisplay && (
                            <span className="text-gray-500 font-mono text-xs ml-2">{s.scoreDisplay}</span>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        {s.won === true && (
                          <span className="text-[10px] font-bold text-[#21BA45] tabular-nums">W</span>
                        )}
                        {s.won === false && (
                          <span className="text-[10px] font-bold text-gray-500 tabular-nums">L</span>
                        )}
                        {s.won === null && (
                          <span className="text-[10px] text-gray-600">—</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

type PhasePool = NonNullable<Extract<Snapshot, { ok: true }>['currentPhasePool']>;
type PoolMatch = PhasePool['matches'][number];

type PoolColumn = { label: string; matches: PoolMatch[]; sortKey: number; firstIdx: number };

function isLosersSideMatch(m: PoolMatch): boolean {
  const t = m.roundText.toLowerCase();
  return t.includes('loser') || (m.round != null && m.round < 0);
}

function groupPoolIntoColumns(matches: PoolMatch[], losers = false): PoolColumn[] {
  const byLabel = new Map<string, PoolMatch[]>();
  const firstIdx = new Map<string, number>();
  matches.forEach((m, i) => {
    const label = m.roundText.trim() || (m.round != null ? `Round ${m.round}` : 'Matches');
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      firstIdx.set(label, i);
    }
    byLabel.get(label)!.push(m);
  });
  const cols: PoolColumn[] = [];
  for (const [label, ms] of byLabel) {
    const rounds = ms.map((x) => x.round).filter((r): r is number => r != null);
    let sortKey: number;
    if (rounds.length === 0) {
      sortKey = 9999;
    } else if (losers) {
      sortKey = Math.min(...rounds.map(Math.abs));
    } else {
      sortKey = Math.min(...rounds);
    }
    ms.sort((a, b) =>
      String(a.poolSpot ?? '').localeCompare(String(b.poolSpot ?? ''), undefined, { numeric: true }),
    );
    cols.push({ label, matches: ms, sortKey, firstIdx: firstIdx.get(label) ?? 0 });
  }
  cols.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    return a.firstIdx - b.firstIdx;
  });
  return cols;
}

function buildPoolBracketRows(matches: PoolMatch[]): { title: string | null; columns: PoolColumn[] }[] {
  const winners = matches.filter((m) => !isLosersSideMatch(m));
  const losers = matches.filter((m) => isLosersSideMatch(m));
  const wCols = groupPoolIntoColumns(winners);
  const lCols = groupPoolIntoColumns(losers, true);
  if (wCols.length > 0 && lCols.length > 0) {
    return [
      { title: 'Winners', columns: wCols },
      { title: 'Losers', columns: lCols },
    ];
  }
  if (wCols.length > 0) return [{ title: null, columns: wCols }];
  if (lCols.length > 0) return [{ title: null, columns: lCols }];
  return [{ title: null, columns: groupPoolIntoColumns(matches) }];
}

function PoolMatchCard({ m, viewerEntrantId }: { m: PoolMatch; viewerEntrantId: string }) {
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 transition-colors ${
        m.involvesViewer
          ? 'border-amber-500/40 bg-amber-500/[0.07]'
          : 'border-[#252525] bg-[#0a0a0a]'
      }`}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {m.poolSpot ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a1a1a] border border-[#333] text-[9px] font-bold text-gray-400 tabular-nums">
              {m.poolSpot}
            </span>
          ) : null}
          <span className={`text-[8px] uppercase tracking-wide truncate ${m.completed ? 'text-gray-500' : 'text-amber-600/90'}`}>
            {m.completed ? 'Done' : 'Pending'}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 text-[10px] leading-tight">
        <div
          className={`rounded px-1.5 py-0.5 border truncate ${
            m.sideLeft?.entrantId === viewerEntrantId
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              : 'border-white/[0.06] bg-black/30 text-gray-200'
          }`}
        >
          {m.sideLeft?.name ?? 'TBD'}
        </div>
        <div className="text-center text-[8px] text-gray-600 py-0.5">vs</div>
        <div
          className={`rounded px-1.5 py-0.5 border truncate text-right ${
            m.sideRight?.entrantId === viewerEntrantId
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              : 'border-white/[0.06] bg-black/30 text-gray-200'
          }`}
        >
          {m.sideRight?.name ?? 'TBD'}
        </div>
      </div>
      {m.scoreDisplay ? (
        <p className="text-[9px] font-mono text-gray-500 text-center mt-1">{m.scoreDisplay}</p>
      ) : null}
    </div>
  );
}

function CashboxPhasePoolView({ pool, viewerEntrantId }: { pool: PhasePool; viewerEntrantId: string }) {
  const rows = buildPoolBracketRows(pool.matches);

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111] overflow-hidden flex flex-col max-h-[min(700px,75vh)] min-h-[300px]">
      <div className="overflow-y-auto overflow-x-auto px-3 py-3 min-h-[260px]">
        <div className="min-w-max space-y-8">
          {rows.map((row) => (
            <div key={row.title ?? 'bracket'}>
              {row.title ? (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-3">{row.title}</p>
              ) : null}
              <div className="flex flex-row items-start gap-0">
                {row.columns.map((col, colIdx) => (
                  <div
                    key={`${row.title ?? 'row'}-${col.label}-${col.firstIdx}`}
                    className="flex flex-row items-stretch shrink-0"
                  >
                    <div className="flex flex-col w-[148px] shrink-0 px-1">
                      <div className="text-center border-b border-[#2a2a2a] pb-2 mb-2 min-h-[32px] flex items-end justify-center">
                        <span className="text-[10px] font-semibold text-gray-300 leading-tight px-0.5">{col.label}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {col.matches.map((m) => (
                          <PoolMatchCard key={m.setId} m={m} viewerEntrantId={viewerEntrantId} />
                        ))}
                      </div>
                    </div>
                    {colIdx < row.columns.length - 1 ? (
                      <div
                        className="w-5 shrink-0 flex items-center justify-center self-stretch pt-10"
                        aria-hidden
                      >
                        <div className="w-px h-[calc(100%-2.5rem)] min-h-[48px] bg-gradient-to-b from-transparent via-[#3a3a3a] to-transparent" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StartGgLinkCard({
  connected,
  displayName,
  onConnect,
  onDisconnect,
  busy,
}: {
  connected: boolean;
  displayName: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">start.gg account</p>
      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-200">
            Linked as <span className="text-white font-medium">{displayName || 'start.gg user'}</span>
          </p>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="text-[11px] text-gray-500 hover:text-red-400 disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            Connect your start.gg account to auto-find your bracket entry and enable in-app check-in.
          </p>
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="rounded-lg bg-[#21BA45] px-3 py-2 text-xs font-bold text-white hover:bg-[#1ea33e] disabled:opacity-50 transition-colors"
          >
            {busy ? 'Connecting…' : 'Connect start.gg'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Cashbox() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [snapWarning, setSnapWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState<string | true | null>(null);
  const [adding, setAdding] = useState(false);
  const [addState, setAddState] = useState<'pending' | 'friends' | null>(null);
  const [addNoteModal, setAddNoteModal] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);
  const [sggConnected, setSggConnected] = useState(false);
  const [sggDisplayName, setSggDisplayName] = useState<string | null>(null);
  const [sggUserId, setSggUserId] = useState<string | null>(null);
  const [sggBusy, setSggBusy] = useState(false);
  const [connectCode, setConnectCode] = useState<string | null>(null);
  const [luckyStats, setLuckyStats] = useState<LuckyStatsOpponent | null>(null);
  const [luckyStatsLoading, setLuckyStatsLoading] = useState(false);
  const [selfElo, setSelfElo] = useState<number | null>(null);
  const [liveOpponentConnectCode, setLiveOpponentConnectCodeRaw] = useState<string | null>(null);
  const liveCodeSetIdRef = useRef<string | null>(null);
  const setLiveOpponentConnectCode = (code: string | null) => {
    if (code) setLiveOpponentConnectCodeRaw(code);
  };
  const [lobbyFriendlies, setLobbyFriendlies] = useState<CashboxFriendlies | null>(null);
  const lastGoodSnapRef = useRef<Snapshot | null>(null);

  useEffect(() => {
    window.api.getProfile().then((p: any) => {
      if (p?.connect_code) setConnectCode(String(p.connect_code));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.getCashboxSnapshot();
      const nextSnap = data as Snapshot;
      const msg = !nextSnap.ok ? String(nextSnap.message ?? '') : '';
      const rateLimited = !nextSnap.ok
        && nextSnap.reason === 'config'
        && msg.toLowerCase().includes('rate limit');
      if (rateLimited && lastGoodSnapRef.current?.ok) {
        setSnapWarning('start.gg API rate-limited; showing last known match state.');
      } else {
        setSnap(nextSnap);
        if (nextSnap.ok) lastGoodSnapRef.current = nextSnap;
        setSnapWarning(null);
      }
      if (data && typeof data === 'object' && (data as Snapshot).ok) {
        const ok = data as Extract<Snapshot, { ok: true }>;
        const fs = ok.nextMatch?.friendlies?.friendStatus;
        if (fs === 'friends') setAddState('friends');
        else if (fs === 'pending_out') setAddState('pending');
        else setAddState(null);
        setInviteSent(null);
      }
    } catch (e) {
      console.error('cashbox', e);
      setSnap({
        ok: false,
        reason: 'api',
        message: 'Failed to load Cashbox data.',
        giveawayRegisterUrl: FALLBACK_CASHBOX_REGISTER,
      });
    }
    setLoading(false);
  }, []);

  const eventCompleted = snap?.ok && snap.extras.eventState === '3';
  if (snap?.ok) {
    console.log('[cashbox ui] eventState=%s nextMatch=%s bracketSets=%d', snap.extras.eventState, !!snap.nextMatch, snap.bracketSets.length);
  }
  const eventNotStarted = snap?.ok && (
    snap.extras.eventState === '1'
    || snap.extras.eventState === null
    || (!snap.nextMatch && snap.bracketSets.every((s) => s.state !== 'completed'))
  );
  const hasPendingSets = snap?.ok
    ? snap.bracketSets.some((s) => s.state === 'pending')
    : false;
  const betweenSets = snap?.ok && !snap.nextMatch && !eventCompleted;

  useEffect(() => {
    void load();
    let active = true;
    let tid: ReturnType<typeof setTimeout> | null = null;
    function scheduleNext() {
      if (!active) return;
      const interval = betweenSets ? 8_000 : 45_000;
      tid = setTimeout(() => { void load().then(scheduleNext); }, interval);
    }
    scheduleNext();
    return () => { active = false; if (tid) clearTimeout(tid); };
  }, [load, betweenSets]);

  useEffect(() => {
    window.api.isStartGgConnected().then((info: any) => {
      setSggConnected(info.connected);
      setSggDisplayName(info.displayName);
      setSggUserId(info.userId ?? null);
    });
    const unsub = window.api.onStartGgAuthChanged((connected) => {
      setSggConnected(connected);
      if (connected) {
        window.api.isStartGgConnected().then((info: any) => {
          setSggDisplayName(info.displayName);
          setSggUserId(info.userId ?? null);
        });
        void load();
      } else {
        setSggDisplayName(null);
        setSggUserId(null);
      }
    });
    return unsub;
  }, [load]);

  async function handleInvite(connectCode: string) {
    setInviting(true);
    const result = await window.api.sendPlayInvite(connectCode);
    if (result.error) setInviteSent(result.error);
    else setInviteSent(true);
    setInviting(false);
  }

  async function handleAddConfirm() {
    const code = addNoteModal;
    if (!code) return;
    setAddNoteModal(null);
    setAdding(true);
    const result = await window.api.addFriend(code, addNote ?? undefined);
    if (result.ok || result.mutual) {
      setAddState(result.mutual ? 'friends' : 'pending');
    }
    setAddNote(null);
    setAdding(false);
  }

  async function handleStartGgConnect() {
    setSggBusy(true);
    try {
      await window.api.connectStartGg();
    } catch (e) {
      console.error('startgg connect', e);
    }
    setSggBusy(false);
  }

  async function handleStartGgDisconnect() {
    setSggBusy(true);
    try {
      await window.api.disconnectStartGg();
      setSggConnected(false);
      setSggDisplayName(null);
      setSnap(null);
      lastGoodSnapRef.current = null;
    } catch (e) {
      console.error('startgg disconnect', e);
    }
    setSggBusy(false);
  }

  const next = snap && snap.ok ? snap.nextMatch : null;
  const fr = next?.friendlies ?? lobbyFriendlies;
  const opponentStartGgUserId = next?.startGg?.userId ? String(next.startGg.userId) : null;
  const resolvedOpponentConnectCode = liveOpponentConnectCode ?? next?.slippiConnectCode ?? fr?.connectCode ?? null;
  const friendliesRankLabel = fr?.rating != null ? getRankLabel(getRankTier(Number(fr.rating))) : null;

  const [topLaunching, setTopLaunching] = useState(false);
  const [topDcStatus, setTopDcStatus] = useState<{ status: string; message: string } | null>(null);
  useEffect(() => {
    const unsub = window.api.onDirectConnectStatus((evt: any) => {
      setTopDcStatus(evt);
      if (evt.status === 'ready' || evt.status === 'error') setTopLaunching(false);
    });
    return unsub;
  }, []);
  async function handleTopLaunchMelee() {
    if (!resolvedOpponentConnectCode) return;
    setTopLaunching(true);
    setTopDcStatus({ status: 'configuring', message: `Launching Melee → ${resolvedOpponentConnectCode}…` });
    const result = await window.api.startDirectConnect(resolvedOpponentConnectCode);
    if (result.error) {
      setTopDcStatus({ status: 'error', message: result.error });
      setTopLaunching(false);
    }
  }

  useEffect(() => {
    const newSetId = next?.setId ?? null;
    if (newSetId && liveCodeSetIdRef.current && newSetId !== liveCodeSetIdRef.current) {
      setLiveOpponentConnectCodeRaw(null);
      setLobbyFriendlies(null);
    }
    if (newSetId) liveCodeSetIdRef.current = newSetId;
  }, [next?.setId]);

  useEffect(() => {
    if (!liveOpponentConnectCode || next?.friendlies) return;
    let cancelled = false;
    window.api.lookupCashboxOpponent(liveOpponentConnectCode).then((r) => {
      if (cancelled || !r.ok || !r.friendlies) return;
      setLobbyFriendlies(r.friendlies);
      const fs = r.friendlies.friendStatus;
      if (fs === 'friends') setAddState('friends');
      else if (fs === 'pending_out') setAddState('pending');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [liveOpponentConnectCode, next?.friendlies]);

  useEffect(() => {
    if (!opponentStartGgUserId) {
      setLuckyStats(null);
      setLuckyStatsLoading(false);
      return;
    }
    let cancelled = false;
    async function loadLuckyStats() {
      setLuckyStatsLoading(true);
      try {
        const res = await fetch(`https://luckystats.gg/api/stream/players?ids=${encodeURIComponent(opponentStartGgUserId!)}`);
        const json = await res.json();
        if (!cancelled) setLuckyStats(extractLuckyStatsPlayer(json, opponentStartGgUserId!));
      } catch {
        if (!cancelled) setLuckyStats(null);
      } finally {
        if (!cancelled) setLuckyStatsLoading(false);
      }
    }
    void loadLuckyStats();
    return () => {
      cancelled = true;
    };
  }, [opponentStartGgUserId]);

  useEffect(() => {
    if (!sggUserId) { setSelfElo(null); return; }
    let cancelled = false;
    fetch(`https://luckystats.gg/api/stream/players?ids=${encodeURIComponent(sggUserId)}`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setSelfElo(extractLuckyStatsPlayer(json, sggUserId)?.elo ?? null); })
      .catch(() => { if (!cancelled) setSelfElo(null); });
    return () => { cancelled = true; };
  }, [sggUserId]);

  const CASHBOX_GO_LIVE = new Date('2026-04-07T17:30:00-04:00').getTime();
  const DEV_BYPASS_CODES = ['SMOK#1'];
  const isLive = Date.now() >= CASHBOX_GO_LIVE || (connectCode != null && DEV_BYPASS_CODES.includes(connectCode));

  if (!isLive) {
    return (
      <div className="space-y-4 p-6 max-w-4xl">
        <div>
          <h1 className="text-xl font-display font-bold text-white">Cashbox</h1>
        </div>
        <GiveawayPromoCard registerUrl={snap?.ok ? snap.giveawayRegisterUrl : FALLBACK_CASHBOX_REGISTER} />
        <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-6 space-y-3 text-center">
          <p className="text-sm text-white font-medium">This feature goes live on April 7th for Cashbox</p>
          <p className="text-xs text-gray-400 leading-relaxed">
            You&apos;ll be able to sign in with start.gg, check in to your matches, choose characters
            and stages, and launch Melee directly to your opponent&apos;s connect code all without
            leaving the app.
          </p>
          <p className="text-[11px] text-gray-600">
            {new Date(CASHBOX_GO_LIVE).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
          </p>
        </div>
        <StartGgLinkCard
          connected={sggConnected}
          displayName={sggDisplayName}
          onConnect={handleStartGgConnect}
          onDisconnect={handleStartGgDisconnect}
          busy={sggBusy}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6 max-w-4xl">
      {snapWarning && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {snapWarning}
        </div>
      )}

      <div>
        <h1 className="text-xl font-display font-bold text-white">Cashbox</h1>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="mt-2 rounded-md bg-[#21BA45] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1ea33e] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      {!sggConnected && !loading ? (
        <div className="space-y-4">
          <GiveawayPromoCard registerUrl={FALLBACK_CASHBOX_REGISTER} />
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-6 space-y-4">
            <div className="text-center space-y-2">
              <h2 className="text-lg font-display font-bold text-white">Connect your start.gg account</h2>
              <p className="text-sm text-gray-400 leading-relaxed max-w-md mx-auto">
                Link your start.gg account to see your bracket, check in to matches,
                choose characters and stages, and launch Melee directly to your opponent.
              </p>
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleStartGgConnect}
                disabled={sggBusy}
                className="rounded-lg bg-[#21BA45] px-6 py-3 text-sm font-bold text-white hover:bg-[#1ea33e] disabled:opacity-50 transition-colors"
              >
                {sggBusy ? 'Connecting\u2026' : 'Connect start.gg'}
              </button>
            </div>
          </div>
        </div>
      ) : loading && !snap ? (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-10 text-center text-sm text-gray-500 animate-pulse">
          Loading…
        </div>
      ) : snap && !snap.ok ? (
        <div className="space-y-4">
          {snap.reason === 'not_mapped' && snap.startggConnected ? (
            <div className="rounded-xl border border-amber-500/25 bg-gradient-to-b from-amber-500/10 to-[#111] px-4 py-5 space-y-3 text-center">
              <p className="text-sm text-white font-medium">You&apos;re not registered for Cashbox yet</p>
              <p className="text-xs text-gray-400 leading-relaxed max-w-md mx-auto">
                Your start.gg account is connected, but you&apos;re not in the bracket.
                Register on start.gg if it&apos;s not too late!
              </p>
              <button
                type="button"
                onClick={() => void window.api.openExternal(snap.giveawayRegisterUrl ?? FALLBACK_CASHBOX_REGISTER)}
                className="rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-black hover:bg-amber-400 transition-colors"
              >
                Register on start.gg (Cashbox)
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-6 space-y-2">
              <p className="text-sm text-yellow-200/90 font-medium">
                {snap.reason === 'no_token' && 'Start.gg token not configured'}
                {snap.reason === 'not_mapped' && 'Could not find your registration'}
                {snap.reason === 'config' && 'Tournament configuration'}
                {snap.reason === 'api' && 'Could not reach start.gg'}
                {!['no_token', 'not_mapped', 'config', 'api'].includes(snap.reason) && 'Unavailable'}
              </p>
              <p className="text-xs text-gray-400 leading-relaxed">{snap.message}</p>
            </div>
          )}
          <StartGgLinkCard
            connected={sggConnected}
            displayName={sggDisplayName}
            onConnect={handleStartGgConnect}
            onDisconnect={handleStartGgDisconnect}
            busy={sggBusy}
          />
        </div>
      ) : snap?.ok && eventNotStarted ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/10 to-[#111] px-4 py-5 space-y-4">
            <div className="text-center space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">You&apos;re registered!</p>
              <p className="text-lg font-display font-bold text-white">{snap.tournamentName}</p>
              <p className="text-sm text-gray-300">{snap.eventName}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                <p className="text-gray-500">Playing as</p>
                <p className="text-gray-100 font-medium">{snap.entrantName}</p>
              </div>
              <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                <p className="text-gray-500">Connect Code</p>
                <p className="text-gray-100 font-mono">{connectCode ?? 'Not linked'}</p>
              </div>
              <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                <p className="text-gray-500">LuckyStats Elo</p>
                <p className="text-gray-100 font-semibold">
                  {selfElo != null ? String(Math.round(selfElo)) : 'Unavailable'}
                </p>
              </div>
              {snap.extras.initialSeed != null && (
                <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                  <p className="text-gray-500">Seed</p>
                  <p className="text-gray-100 font-semibold">{snap.extras.initialSeed}</p>
                </div>
              )}
              {snap.extras.eventEntrantCount != null && (
                <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                  <p className="text-gray-500">Entrants</p>
                  <p className="text-gray-100 font-semibold">{snap.extras.eventEntrantCount}</p>
                </div>
              )}
            </div>

            <div className="text-center pt-1">
              <p className="text-sm text-amber-300 font-medium">Come back here when the tournament starts!</p>
              {formatStartGgTimestamp(snap.extras.eventStartAt) && (
                <p className="text-xs text-gray-500 mt-1">
                  Starts: {formatStartGgTimestamp(snap.extras.eventStartAt)}
                </p>
              )}
            </div>
          </div>

          <StartGgLinkCard
            connected={sggConnected}
            displayName={sggDisplayName}
            onConnect={handleStartGgConnect}
            onDisconnect={handleStartGgDisconnect}
            busy={sggBusy}
          />
        </div>
      ) : snap?.ok ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-4 space-y-4">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Next match</h2>
            {!next ? (
              eventCompleted ? (
                <p className="text-sm text-gray-500">Bracket complete — no more sets.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-400">Waiting for bracket to update…</p>
                  {snap.currentPhasePool && (
                    <p className="text-xs text-gray-500">
                      Phase: <span className="text-gray-300">{snap.currentPhasePool.title}</span>
                    </p>
                  )}
                  <p className="text-xs text-gray-500">Your next match will load here soon.</p>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-[11px] text-amber-300/80">Checking every few seconds</span>
                  </div>
                </div>
              )
            ) : (
              <>
                <div className="rounded-xl border border-[#2c2c2c] bg-gradient-to-br from-[#171717] via-[#121212] to-[#101010] px-4 py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-500">Set details</p>
                      <p className="text-lg text-white font-semibold mt-1">{next.roundText}</p>
                      {next.scoreDisplay && (
                        <p className="text-xs text-gray-500 mt-0.5">{next.scoreDisplay}</p>
                      )}
                    </div>
                    {next.bestOf != null && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                        Bo{next.bestOf}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                      <p className="text-gray-500">Opponent</p>
                      <p className="text-gray-100 font-medium truncate">{next.opponentName || 'TBD'}</p>
                    </div>
                    <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                      <p className="text-gray-500">Connect Code</p>
                      <p className="text-gray-100 font-mono">{resolvedOpponentConnectCode ?? 'Unknown'}</p>
                    </div>
                    <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                      <p className="text-gray-500">LuckyStats Elo</p>
                      <p className="text-gray-100 font-semibold">
                        {luckyStatsLoading
                          ? 'Loading...'
                          : luckyStats?.elo != null
                            ? String(Math.round(luckyStats.elo))
                            : 'Unavailable'}
                      </p>
                    </div>
                    <div className="rounded-md border border-[#2a2a2a] bg-black/25 px-2.5 py-2">
                      <p className="text-gray-500">Slippi Rank</p>
                      <p className="text-gray-100 font-semibold">
                        {friendliesRankLabel ?? 'Unavailable'}
                      </p>
                    </div>
                  </div>

                  {resolvedOpponentConnectCode && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleTopLaunchMelee}
                        disabled={topLaunching}
                        className="rounded-md bg-[#7c3aed] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors flex items-center gap-1.5"
                      >
                        {topLaunching ? 'Launching…' : `Open Melee → ${resolvedOpponentConnectCode}`}
                      </button>
                      {topDcStatus && (
                        <span className={`text-[11px] ${topDcStatus.status === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
                          {topDcStatus.message}
                        </span>
                      )}
                    </div>
                  )}

                </div>

                {snap.matchModeration && snap.matchModeration.tasks.length > 0 && (
                  <CashboxMatchModerationPanel
                    mod={snap.matchModeration}
                    onRefresh={load}
                    parentLoading={loading}
                  />
                )}

                <SetTaskFlow
                  next={next}
                  sggConnected={sggConnected}
                  onRefresh={load}
                  opponentConnectCodeFallback={resolvedOpponentConnectCode}
                  onOpponentCodeResolved={setLiveOpponentConnectCode}
                  setUrl={snap.matchModeration?.setUrl}
                />
              </>
            )}
          </div>

          {snap.currentPhasePool && snap.currentPhasePool.matches.length > 0 && (
            <CashboxPhasePoolView pool={snap.currentPhasePool} viewerEntrantId={snap.entrantId} />
          )}

          {/* TODO: re-enable these once Cashbox integration is further along
          <GiveawayPromoCard registerUrl={snap.giveawayRegisterUrl} />

          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-4 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{snap.tournamentName}</p>
            <p className="text-sm text-white font-medium">{snap.eventName}</p>
            <p className="text-xs text-gray-400">Playing as {snap.entrantName}</p>
            <p className="text-xs text-gray-500">
              Record (reported sets):{' '}
              <span className="text-gray-300">
                {snap.record.wins}W — {snap.record.losses}L
              </span>
            </p>
            <button
              type="button"
              onClick={() => void window.api.openExternal(snap.bracketUrl)}
              className="mt-2 text-xs text-[#21BA45] hover:underline"
            >
              Open bracket on start.gg
            </button>
          </div>

          <CashboxNativeBracket
            sets={snap.bracketSets ?? []}
            entrantName={snap.entrantName}
            bracketUrl={snap.bracketUrl}
            overviewUrl={snap.bracketEmbedUrl}
          />

          {snap.extras && (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 space-y-3">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Event snapshot</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-400">
                {snap.extras.initialSeed != null && (
                  <span>
                    Your seed: <span className="text-gray-200 font-mono">{snap.extras.initialSeed}</span>
                  </span>
                )}
                {snap.extras.eventEntrantCount != null && (
                  <span>
                    Entrants: <span className="text-gray-200">{snap.extras.eventEntrantCount}</span>
                  </span>
                )}
                {snap.extras.eventState && (
                  <span>
                    Event state: <span className="text-gray-200">{snap.extras.eventState}</span>
                  </span>
                )}
                {formatStartGgTimestamp(snap.extras.eventStartAt) && (
                  <span>
                    Starts: <span className="text-gray-200">{formatStartGgTimestamp(snap.extras.eventStartAt)}</span>
                  </span>
                )}
                {snap.extras.isDisqualified && (
                  <span className="text-red-400 font-medium">Disqualified</span>
                )}
              </div>
              {snap.extras.streamQueues.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Stream queue</p>
                  <ul className="space-y-1 max-h-36 overflow-y-auto text-[11px] text-gray-400">
                    {snap.extras.streamQueues.map((row, i) => (
                      <li key={`${row.streamLabel}-${i}`}>
                        <span className="text-amber-500/80">{row.streamLabel}</span>
                        <span className="text-gray-500"> — </span>
                        {row.setLabel}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          */}

          <StartGgLinkCard
            connected={sggConnected}
            displayName={sggDisplayName}
            onConnect={handleStartGgConnect}
            onDisconnect={handleStartGgDisconnect}
            busy={sggBusy}
          />

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-xs text-gray-500 hover:text-white disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      ) : null}

      {addNoteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setAddNoteModal(null)}
          onKeyDown={(e) => e.key === 'Escape' && setAddNoteModal(null)}
          role="presentation"
        >
          <div
            className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 w-[360px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
          >
            <p className="text-sm text-white font-semibold text-center">
              Add <span className="font-mono text-[#21BA45]">{addNoteModal}</span>
            </p>
            <p className="text-xs text-gray-400 text-center mt-2 leading-relaxed">
              Optional note (same as Discover).
            </p>
            <div className="flex flex-wrap gap-2 mt-4 justify-center">
              {['Bracket opponent', 'GGs', 'Similar skill', 'MU practice'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setAddNote(addNote === tag ? null : tag)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    addNote === tag
                      ? 'bg-[#21BA45]/20 text-[#21BA45] border border-[#21BA45]/40'
                      : 'bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a] hover:border-gray-500'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => { setAddNote(null); setAddNoteModal(null); }}
                className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleAddConfirm()}
                className="flex-1 rounded-lg bg-[#21BA45] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1ea33e] transition-colors"
              >
                {addNote ? 'Send with note' : 'Send without note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
