import type { ActivePlayerDetailsSnapshot, CoachReportInput, CoachTone, MatchContext, NormalizedEvent, NormalizedPlayerSnapshot, NormalizedSnapshot, RawLiveDataTelemetry, VisualObservation } from "@riftcoach/core";
import { CoachReportJsonSchema, casualGameLabel, casualGameReason, formatTime, isCasualReviewMode } from "@riftcoach/core";

export function buildPostGameCoachMessages(input: CoachReportInput): Array<{ role: "system" | "user"; content: string }> {
  if (isCasualReviewMode(input.match.game)) return buildCasualModeMessages(input);

  return [
    {
      role: "system",
      content: [
        "You are RiftCoach, a League of Legends post-game coach.",
        "Use only the facts supplied by the app.",
        "Do not invent hidden information, enemy positions, Riot API fields, Riot endpoints, or matchup facts not supplied.",
        "Do not give real-time tactical shot-calling.",
        "Focus on one high-impact improvement and one practical next-game drill.",
        "Be detailed but focused: explain the decision pattern, the supplied evidence, the consequence, and the concrete correction with enough detail that the player can execute it next game.",
        "Use the word budget. A good coaching report is usually several substantial paragraphs plus a practical drill, not a single sentence diagnosis.",
        "Prefer 2 to 4 timeline notes when the packet contains timestamped evidence, and make each note explain the decision at that moment.",
        "Use the telemetry block as first-class evidence: check key snapshots, final scoreboard, combat events, objectives, item progression, and role evidence before choosing the main focus.",
        "When rawRiotLiveClient data is present, inspect it before deciding. It is raw Riot /liveclientdata/allgamedata JSON from selected stored snapshots, not a summary.",
        "Treat Live Client values as sampled snapshots. Do not claim exact HP, resource, cooldown, dead/alive, or item state at a death unless a supplied raw or normalized snapshot is at that moment or very near it.",
        "RiftCoach does not receive camera intent, wave/minion positions, mouse input, exact pathing between samples, or exact ability casts from Riot Live Client data. Only claim those from visual bookmarks if supplied.",
        "When the telemetry block says visual-only upload or replay review, do not infer missing scoreboard, champion, matchup, objective, or item facts. Use visual bookmarks as the primary evidence.",
        "Benchmarks are context, not the review. Never make CS, gold, vision, or benchmark deltas the main mistake by themselves.",
        "If a benchmark looks bad, tie it to a concrete decision pattern from telemetry: death timing, wave choice, recall timing, objective setup, positioning, or a visual bookmark.",
        "Prefer a timestamped decision mistake over a generic statistical comparison whenever both are available.",
        "Do not write vague report-card prose like 'performance was hindered', 'significant deficit relative to benchmarks', 'gold disadvantage', 'excessive deaths', or 'decent vision control'.",
        "Every useful review must answer: what exact situation happened, what decision was wrong, what should the player do instead next time, and how to measure it.",
        "Use matchup context when supplied, but do not claim external facts that are not in the packet.",
        "When web snippets are supplied, treat them as supporting context only; prefer the player telemetry and expert-system insights.",
        toneInstruction(input.settings.coachTone),
        "Return strict JSON matching the provided schema."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(buildCoachPacket(input))
    }
  ];
}

export function buildCoachPacket(input: CoachReportInput): unknown {
  const { match, insights, profile, settings, knowledge } = input;
  const reason = casualGameReason(match.game);
  const visualOnly = isVisualOnlyMatch(match);
  return {
    schema: CoachReportJsonSchema,
    coachTone: settings.coachTone,
    privacyMode: settings.privacyMode,
    game: {
      gameMode: match.game?.gameMode,
      mapName: match.game?.mapName,
      mapNumber: match.game?.mapNumber,
      reviewMode: match.game?.reviewMode ?? (reason ? "casual_mode" : "coaching"),
      casualReason: reason,
      evidence: [
        match.game?.gameMode ? `Live Client gameMode: ${match.game.gameMode}` : undefined,
        match.game?.mapName ? `Live Client mapName: ${match.game.mapName}` : undefined,
        typeof match.game?.mapNumber === "number" ? `Live Client mapNumber: ${match.game.mapNumber}` : undefined
      ].filter((value): value is string => Boolean(value))
    },
    player: {
      champion: match.player.championName,
      role: match.player.role,
      roleConfidence: match.player.roleConfidence,
      roleSource: match.player.roleSource,
      rank: match.player.rank ?? profile?.rank,
      learningGoal: profile?.learningGoal
    },
    matchSummary: visualOnly
      ? {
          duration: formatTime(match.aggregate.durationSec),
          evidenceMode: match.game?.gameMode === "ROFL_REPLAY" ? "rofl_replay_visual_only" : "uploaded_vod_visual_only",
          note: "No Riot Live Client scoreboard, champion, event, item, CS, or ward telemetry was available for this visual-only review."
        }
      : {
          duration: formatTime(match.aggregate.durationSec),
          kills: match.aggregate.kills,
          deaths: match.aggregate.deaths,
          assists: match.aggregate.assists,
          csAt10: match.aggregate.csAt10,
          csAt15: match.aggregate.csAt15,
          csPerMin: Number(match.aggregate.csPerMin.toFixed(2)),
          visionScore: match.aggregate.visionScore,
          deathsBefore10: match.aggregate.deathsBefore10,
          finalItems: match.aggregate.itemNamesFinal
        },
    telemetry: buildTelemetryPacket(match, settings),
    knowledgeContext: knowledge
      ? {
          mode: knowledge.mode,
          evidenceMode: knowledge.evidenceMode,
          benchmarkComparisons: knowledge.benchmarkComparisons.map((comparison) => ({
            metric: comparison.metric,
            label: comparison.label,
            playerValue: comparison.playerValue,
            median: comparison.median,
            p25: comparison.p25,
            p75: comparison.p75,
            unit: comparison.unit,
            interpretation: comparison.interpretation,
            confidence: comparison.confidence,
            scope: comparison.scope,
            source: comparison.source
          })),
          matchupTips: knowledge.matchupTips.map((tip) => ({
            champion: tip.champion,
            role: tip.role,
            opponentChampion: tip.opponentChampion,
            matchupDifficulty: tip.matchupDifficulty,
            lanePlan: tip.lanePlan,
            dangerWindows: tip.dangerWindows,
            commonMistakes: tip.commonMistakes,
            source: tip.source,
            confidence: tip.confidence
          })),
          webSources: knowledge.webSources.map((source) => ({
            title: source.title,
            url: source.url,
            snippet: source.snippet,
            query: source.query,
            reliability: source.reliability
          })),
          warnings: knowledge.warnings
        }
      : undefined,
    insights: insights.map((insight) => ({
      category: insight.category,
      severity: insight.severity,
      confidence: insight.confidence,
      title: insight.title,
      evidence: insight.evidence,
      affectedTimestamps: insight.affectedTimestamps.map(formatTime),
      recommendedFocus: insight.recommendedFocus
    })),
    instruction: {
      requiredOutput:
        "Return only JSON with keys reviewType, summary, mainMistake, positiveHabit, timelineNotes, nextGameDrill, warnings. Set reviewType to coaching. Evidence must cite supplied insight.evidence, telemetry.evidence, or game.evidence strings. Use complete explanatory paragraphs, not terse one-line analysis. For visual-only VOD or ROFL reviews, explicitly say when a conclusion is based on visual bookmarks rather than scoreboard telemetry.",
      qualityBar: [
        "The summary should be 2 to 4 sentences and must contain one concrete next-game behavior, not just a diagnosis.",
        "mainMistake.title should be an imperative coaching focus such as 'Stop fighting before the wave is playable', not a broad performance label.",
        "mainMistake.explanation should be 4 to 7 sentences. It must include a situation, the bad decision pattern, the replacement decision, and how to recognize the trigger in-game.",
        "mainMistake.whyItMatters should be 2 to 4 sentences and explain the in-game consequence in plain terms.",
        "nextGameDrill.steps must be actions the player can do during a real match. Avoid 'review the replay', 'focus on farming', or 'improve vision' unless paired with exact triggers.",
        "nextGameDrill.steps should each be a complete sentence with a trigger and an action.",
        "nextGameDrill.successMetric must be countable from the next match."
      ],
      forbiddenPatterns: [
        "benchmark-only diagnosis",
        "performance was hindered",
        "significant deficit relative to benchmarks",
        "gold disadvantage",
        "excessive deaths without explaining the repeatable cause",
        "decent vision control as filler praise"
      ],
      drillStyle: "measurable, usable for next 1 to 5 games"
    }
  };
}

function isVisualOnlyMatch(match: MatchContext): boolean {
  return match.game?.gameMode === "VOD_REVIEW" || match.game?.gameMode === "ROFL_REPLAY";
}

function toneInstruction(tone: CoachTone): string {
  switch (tone) {
    case "supportive":
      return "Tone: supportive, patient, and confidence-building while still being specific about the mistake.";
    case "analytical":
      return "Tone: analytical and evidence-heavy, with clear cause-and-effect reasoning.";
    case "concise":
      return "Tone: concise and direct. Keep explanations tight but actionable.";
    case "toxic":
      return [
        "Tone: high-energy ranked-solo-queue roast. Be blunt, spicy, and a little trash-talky about the player's decisions.",
        "Do not impersonate any specific streamer or real person.",
        "Do not use slurs, hate, protected-class insults, self-harm language, threats, or demeaning attacks on the player's identity.",
        "Roast the gameplay pattern, then give a useful correction."
      ].join(" ");
    case "direct":
    default:
      return "Tone: direct and practical. Be honest without being cruel.";
  }
}

type TelemetryParticipant = {
  subject: boolean;
  team: "ORDER" | "CHAOS" | "UNKNOWN";
  champion: string;
  role?: string;
  livePosition?: string;
  level?: number;
  isDead?: boolean;
  respawnTimer?: number;
  roleConfidence?: number;
  roleSource?: string;
  summonerSpells: string[];
  runes?: ReturnType<typeof summarizeRunes>;
  scores: {
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
    visionScore?: number;
  };
  finalItems: string[];
};

type TelemetrySnapshot = {
  checkpoint: string;
  timestamp: string;
  timestampSec: number;
  phase: string;
  player: {
    champion: string;
    role?: string;
    livePosition?: string;
    level?: number;
    currentGold?: number;
    health?: string;
    resource?: string;
    coreStats?: Record<string, number>;
    abilities?: Array<{ slot: string; name?: string; level?: number; id?: string }>;
    runes?: ReturnType<typeof summarizeRunes>;
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
    csPerMin: number;
    visionScore?: number;
    items: string[];
  };
  teamKills?: number;
  enemyTeamKills?: number;
};

type ParticipantDescriptor = {
  team?: "ORDER" | "CHAOS" | "UNKNOWN";
  champion: string;
  role?: string;
};

type CombatEventTelemetry = {
  timestamp: string;
  timestampSec: number;
  eventType: "kill" | "death" | "assist";
  killer?: ParticipantDescriptor;
  victim?: ParticipantDescriptor;
  assistingChampions: ParticipantDescriptor[];
  rawEventName?: string;
};

type ObjectiveEventTelemetry = {
  timestamp: string;
  timestampSec: number;
  eventType: NormalizedEvent["type"];
  actor?: ParticipantDescriptor;
  target?: string;
  rawEventName?: string;
};

const SNAPSHOT_TARGETS = [
  { checkpoint: "5m", timestampSec: 5 * 60 },
  { checkpoint: "10m", timestampSec: 10 * 60 },
  { checkpoint: "15m", timestampSec: 15 * 60 },
  { checkpoint: "20m", timestampSec: 20 * 60 }
] as const;

const OBJECTIVE_EVENT_TYPES = new Set<NormalizedEvent["type"]>(["dragon_kill", "baron_kill", "rift_herald_kill", "turret_kill", "inhibitor_kill"]);
const MAX_OBJECTIVE_EVENTS = 20;
const MAX_COMBAT_EVENTS = 16;
const MAX_ITEM_MILESTONES = 8;
const MAX_VISUAL_BOOKMARKS = 5;

function buildTelemetryPacket(match: MatchContext, settings: CoachReportInput["settings"]): unknown {
  const visualOnly = isVisualOnlyMatch(match);
  const snapshots = visualOnly ? [] : sortedSnapshots(match.snapshots);
  const latest = snapshots.at(-1);
  const keySnapshots = buildKeySnapshots(match, snapshots);
  const participantScoreboard = buildParticipantScoreboard(match, latest);
  const playerItemTimeline = buildPlayerItemTimeline(match, snapshots);
  const objectiveTimeline = buildObjectiveTimeline(match);
  const playerCombatTimeline = buildPlayerCombatTimeline(match);
  const visualBookmarks = buildVisualBookmarks(match.visualObservations ?? []);

  return {
    capture: {
      source: visualOnly
        ? match.game?.gameMode === "ROFL_REPLAY"
          ? "League ROFL replay frames captured by RiftCoach through Riot's local Replay API plus desktop screenshots; no Riot Live Client scoreboard telemetry was recorded for this review"
          : "Uploaded local VOD frames analyzed by RiftCoach; no Riot Live Client telemetry was recorded for this review"
        : "Riot Live Client allgamedata snapshots normalized by RiftCoach",
      totalSnapshots: visualOnly ? 0 : snapshots.length,
      duration: formatTime(match.aggregate.durationSec),
      snapshotCadence: visualOnly ? "not available for visual-only upload or replay review" : inferSnapshotCadence(snapshots)
    },
    dataAvailability: buildDataAvailability(match),
    roleEvidence: {
      champion: match.player.championName,
      role: match.player.role,
      livePosition: match.player.livePosition,
      roleSource: match.player.roleSource,
      roleConfidence: rounded(match.player.roleConfidence)
    },
    keySnapshots,
    participantScoreboard,
    playerItemTimeline,
    objectiveTimeline,
    playerCombatTimeline,
    visualBookmarks,
    rawRiotLiveClient: buildRawRiotLiveClientPacket(match.rawLiveData, {
      includeRawPayloads: settings.aiMode === "local-ollama" && settings.privacyMode === "local-only"
    }),
    evidence: buildTelemetryEvidence({
      match,
      keySnapshots,
      participantScoreboard,
      playerItemTimeline,
      objectiveTimeline,
      playerCombatTimeline,
      visualBookmarks,
      rawLiveData: match.rawLiveData,
      totalSnapshots: snapshots.length
    })
  };
}

function buildKeySnapshots(match: MatchContext, snapshots: NormalizedSnapshot[]): TelemetrySnapshot[] {
  const picks: Array<{ checkpoint: string; snapshot: NormalizedSnapshot }> = [];
  const seen = new Set<number>();
  const add = (checkpoint: string, snapshot?: NormalizedSnapshot): void => {
    if (!snapshot || seen.has(snapshot.timestampSec)) return;
    seen.add(snapshot.timestampSec);
    picks.push({ checkpoint, snapshot });
  };

  for (const target of SNAPSHOT_TARGETS) {
    if (target.timestampSec <= match.aggregate.durationSec) {
      add(target.checkpoint, snapshotAtOrBefore(snapshots, target.timestampSec));
    }
  }
  add("end", snapshots.at(-1));

  return picks.map(({ checkpoint, snapshot }) => summarizeSnapshot(match, snapshot, checkpoint));
}

function summarizeSnapshot(match: MatchContext, snapshot: NormalizedSnapshot, checkpoint: string): TelemetrySnapshot {
  const active = findActiveParticipant(snapshot, match);
  const scores = active?.scores ?? snapshot.scores;
  const items = itemNames(active?.items ?? snapshot.items);
  const team = active?.team;
  const activeDetails = snapshot.activePlayerDetails;
  const stats = activeDetails?.championStats;

  return {
    checkpoint,
    timestamp: formatTime(snapshot.timestampSec),
    timestampSec: snapshot.timestampSec,
    phase: snapshot.phase,
    player: {
      champion: active?.championName ?? match.player.championName,
      role: active?.role ?? snapshot.player.role,
      livePosition: active?.livePosition ?? snapshot.player.livePosition,
      level: snapshot.level,
      currentGold: snapshot.currentGold,
      health: formatStatPair(stats?.currentHealth, stats?.maxHealth),
      resource: formatResource(stats),
      coreStats: summarizeCoreStats(stats),
      abilities: summarizeAbilities(activeDetails),
      runes: summarizeRunes(activeDetails?.runes),
      kills: scores.kills,
      deaths: scores.deaths,
      assists: scores.assists,
      creepScore: scores.creepScore,
      csPerMin: csPerMin(scores.creepScore, snapshot.timestampSec),
      visionScore: scores.wardScore,
      items
    },
    teamKills: team ? teamKills(snapshot, team) : undefined,
    enemyTeamKills: team ? enemyTeamKills(snapshot, team) : undefined
  };
}

function buildParticipantScoreboard(match: MatchContext, latest?: NormalizedSnapshot): TelemetryParticipant[] {
  if (!latest?.allPlayers?.length) return [];
  return latest.allPlayers
    .map((player): TelemetryParticipant => ({
      subject: isMatchPlayer(player, match),
      team: player.team,
      champion: player.championName,
      role: player.role,
      livePosition: player.livePosition,
      roleConfidence: rounded(player.roleConfidence),
      roleSource: player.roleSource,
      level: player.level,
      isDead: player.isDead,
      respawnTimer: player.respawnTimer,
      summonerSpells: compactSummonerSpells(player.summonerSpells),
      runes: summarizeRunes(player.runes),
      scores: {
        kills: player.scores.kills,
        deaths: player.scores.deaths,
        assists: player.scores.assists,
        creepScore: player.scores.creepScore,
        visionScore: player.scores.wardScore
      },
      finalItems: itemNames(player.items)
    }))
    .sort((a, b) => teamOrder(a.team) - teamOrder(b.team) || Number(b.subject) - Number(a.subject) || a.champion.localeCompare(b.champion));
}

function buildPlayerItemTimeline(match: MatchContext, snapshots: NormalizedSnapshot[]): Array<{ timestamp: string; timestampSec: number; items: string[] }> {
  const changes: Array<{ timestamp: string; timestampSec: number; items: string[] }> = [];
  let previousKey = "";

  for (const snapshot of snapshots) {
    const active = findActiveParticipant(snapshot, match);
    const items = itemNames(active?.items ?? snapshot.items);
    const key = items.join("|");
    if (key === previousKey) continue;
    previousKey = key;
    changes.push({ timestamp: formatTime(snapshot.timestampSec), timestampSec: snapshot.timestampSec, items });
  }

  return sampleEvenly(changes, MAX_ITEM_MILESTONES);
}

function buildObjectiveTimeline(match: MatchContext): ObjectiveEventTelemetry[] {
  return sortedEvents(match.events)
    .filter((event) => OBJECTIVE_EVENT_TYPES.has(event.type))
    .slice(0, MAX_OBJECTIVE_EVENTS)
    .map((event) => ({
      timestamp: formatTime(event.timestampSec),
      timestampSec: event.timestampSec,
      eventType: event.type,
      actor: describeParticipant(findParticipantByName(match, event.actorName, event.timestampSec)),
      target: event.type === "turret_kill" || event.type === "inhibitor_kill" ? event.actorName : undefined,
      rawEventName: event.rawEventName
    }));
}

function buildPlayerCombatTimeline(match: MatchContext): CombatEventTelemetry[] {
  return sortedEvents(match.events)
    .filter((event) => event.type === "champion_kill" && playerInvolvedInEvent(match, event))
    .slice(0, MAX_COMBAT_EVENTS)
    .map((event) => {
      const eventType = eventNameMatchesPlayer(match, event.victimName, event.timestampSec)
        ? "death"
        : eventNameMatchesPlayer(match, event.actorName, event.timestampSec)
          ? "kill"
          : "assist";
      return {
        timestamp: formatTime(event.timestampSec),
        timestampSec: event.timestampSec,
        eventType,
        killer: describeParticipant(findParticipantByName(match, event.actorName, event.timestampSec)),
        victim: describeParticipant(findParticipantByName(match, event.victimName, event.timestampSec)),
        assistingChampions: (event.assistingParticipantNames ?? [])
          .map((name) => describeParticipant(findParticipantByName(match, name, event.timestampSec)))
          .filter((participant): participant is ParticipantDescriptor => Boolean(participant)),
        rawEventName: event.rawEventName
      };
    });
}

function buildVisualBookmarks(observations: VisualObservation[]): Array<{ timestamp: string; timestampSec: number; category: string; title: string; details: string; evidence: string[] }> {
  return observations.slice(0, MAX_VISUAL_BOOKMARKS).map((obs) => ({
    timestamp: formatTime(obs.timestampSec),
    timestampSec: obs.timestampSec,
    category: obs.category,
    title: obs.title,
    details: obs.details,
    evidence: obs.evidence
  }));
}

function buildTelemetryEvidence(params: {
  match: MatchContext;
  keySnapshots: TelemetrySnapshot[];
  participantScoreboard: TelemetryParticipant[];
  playerItemTimeline: Array<{ timestamp: string; timestampSec: number; items: string[] }>;
  objectiveTimeline: ObjectiveEventTelemetry[];
  playerCombatTimeline: CombatEventTelemetry[];
  visualBookmarks: Array<{ timestamp: string; title: string }>;
  rawLiveData?: RawLiveDataTelemetry;
  totalSnapshots: number;
}): string[] {
  const evidence: string[] = [];
  if (isVisualOnlyMatch(params.match)) {
    evidence.push(
      `Visual-only ${params.match.game?.gameMode === "ROFL_REPLAY" ? "ROFL replay" : "VOD"} review: no Riot Live Client scoreboard, champion, event, item, CS, or ward telemetry was available; visual bookmarks are the primary evidence.`
    );
    const bookmarks = params.visualBookmarks.map((bookmark) => `${bookmark.timestamp}: ${bookmark.title}`).join("; ");
    if (bookmarks) evidence.push(`Visual bookmarks: ${bookmarks}.`);
    return evidence;
  }

  const roleDetails = [
    params.match.player.livePosition ? `Live Client position ${params.match.player.livePosition}` : undefined,
    `role ${params.match.player.role}`,
    params.match.player.roleSource ? `source ${params.match.player.roleSource}` : undefined,
    typeof params.match.player.roleConfidence === "number" ? `confidence ${rounded(params.match.player.roleConfidence)}` : undefined
  ].filter(Boolean);
  evidence.push(`Role evidence: ${roleDetails.join(", ")}.`);
  evidence.push(`Telemetry capture: ${params.totalSnapshots} Live Client snapshots over ${formatTime(params.match.aggregate.durationSec)}.`);
  if (params.rawLiveData) {
    evidence.push(
      `Raw Riot data: ${params.rawLiveData.includedSnapshots}/${params.rawLiveData.totalStoredSnapshots} stored /allgamedata snapshots included under a ${params.rawLiveData.tokenBudget} token raw telemetry budget.`
    );
  }

  const finalPlayer = params.participantScoreboard.find((player) => player.subject);
  if (finalPlayer) {
    evidence.push(
      `Final scoreboard: ${finalPlayer.champion} ${finalPlayer.role ?? "unknown"} ${scoreLine(finalPlayer.scores)} with ${finalPlayer.scores.creepScore} CS, ${finalPlayer.scores.visionScore ?? "unknown"} vision, items ${finalPlayer.finalItems.join(", ") || "none"}.`
    );
  }

  const sampledTimeline = params.keySnapshots
    .map((snapshot) => `${snapshot.timestamp} ${scoreLine(snapshot.player)} ${snapshot.player.creepScore} CS ${snapshot.player.items.length ? `items ${snapshot.player.items.join("/")}` : "no items"}`)
    .join("; ");
  if (sampledTimeline) evidence.push(`Key snapshot timeline: ${sampledTimeline}.`);

  const combat = params.playerCombatTimeline
    .slice(0, 8)
    .map((event) => `${event.eventType} at ${event.timestamp}${event.killer ? ` by ${event.killer.champion}` : ""}${event.victim ? ` onto ${event.victim.champion}` : ""}`)
    .join("; ");
  if (combat) evidence.push(`Player combat timeline: ${combat}.`);

  const objectives = params.objectiveTimeline
    .slice(0, 8)
    .map((event) => `${event.eventType} at ${event.timestamp}${event.actor ? ` by ${event.actor.team ?? "unknown"} ${event.actor.champion}` : ""}${event.target ? ` target ${event.target}` : ""}`)
    .join("; ");
  if (objectives) evidence.push(`Objective timeline: ${objectives}.`);

  const itemTimeline = params.playerItemTimeline
    .slice(0, 6)
    .map((event) => `${event.timestamp}: ${event.items.join(", ") || "no completed items observed"}`)
    .join("; ");
  if (itemTimeline) evidence.push(`Item progression: ${itemTimeline}.`);

  const bookmarks = params.visualBookmarks.map((bookmark) => `${bookmark.timestamp}: ${bookmark.title}`).join("; ");
  if (bookmarks) evidence.push(`Visual bookmarks: ${bookmarks}.`);

  return evidence;
}

function sortedSnapshots(snapshots: NormalizedSnapshot[]): NormalizedSnapshot[] {
  return [...snapshots].sort((a, b) => a.timestampSec - b.timestampSec);
}

function sortedEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  return [...events].sort((a, b) => a.timestampSec - b.timestampSec);
}

function snapshotAtOrBefore(snapshots: NormalizedSnapshot[], timestampSec: number): NormalizedSnapshot | undefined {
  return snapshots.filter((snapshot) => snapshot.timestampSec <= timestampSec).at(-1) ?? snapshots[0];
}

function findActiveParticipant(snapshot: NormalizedSnapshot, match: MatchContext): NormalizedPlayerSnapshot | undefined {
  const activeNames = participantNameTokens(match.player);
  return snapshot.allPlayers?.find((player) => participantNameTokens(player).some((name) => activeNames.includes(name))) ??
    snapshot.allPlayers?.find((player) => player.championName === match.player.championName && player.role === match.player.role);
}

function findParticipantByName(match: MatchContext, name: string | undefined, timestampSec: number): NormalizedPlayerSnapshot | undefined {
  if (!name) return undefined;
  const snapshots = sortedSnapshots(match.snapshots);
  const candidates = [
    snapshotAtOrBefore(snapshots, timestampSec),
    snapshots.at(-1),
    snapshots[0]
  ].filter((snapshot): snapshot is NormalizedSnapshot => Boolean(snapshot));

  for (const snapshot of candidates) {
    const participant = snapshot.allPlayers?.find((player) => participantMatchesName(player, name));
    if (participant) return participant;
  }
  return undefined;
}

function participantMatchesName(player: Pick<NormalizedPlayerSnapshot, "riotId" | "summonerName">, name: string): boolean {
  const nameTokens = nameVariants(name);
  return participantNameTokens(player).some((token) => nameTokens.includes(token));
}

function eventNameMatchesPlayer(match: MatchContext, name: string | undefined, timestampSec: number): boolean {
  if (!name) return false;
  if (participantMatchesName(match.player, name)) return true;
  const participant = findParticipantByName(match, name, timestampSec);
  return participant ? isMatchPlayer(participant, match) : false;
}

function playerInvolvedInEvent(match: MatchContext, event: NormalizedEvent): boolean {
  return (
    eventNameMatchesPlayer(match, event.actorName, event.timestampSec) ||
    eventNameMatchesPlayer(match, event.victimName, event.timestampSec) ||
    Boolean(event.assistingParticipantNames?.some((name) => eventNameMatchesPlayer(match, name, event.timestampSec)))
  );
}

function isMatchPlayer(player: Pick<NormalizedPlayerSnapshot, "riotId" | "summonerName" | "championName" | "role">, match: MatchContext): boolean {
  const activeNames = participantNameTokens(match.player);
  if (participantNameTokens(player).some((name) => activeNames.includes(name))) return true;
  return player.championName === match.player.championName && player.role === match.player.role;
}

function participantNameTokens(player: Pick<NormalizedPlayerSnapshot, "riotId" | "summonerName"> | MatchContext["player"]): string[] {
  return [...nameVariants(player.riotId), ...nameVariants(player.summonerName)];
}

function nameVariants(value: string | undefined): string[] {
  const raw = value?.trim().toLowerCase();
  if (!raw) return [];
  const withoutTag = raw.split("#")[0];
  return Array.from(new Set([raw, withoutTag].filter((part): part is string => Boolean(part))));
}

function describeParticipant(player: NormalizedPlayerSnapshot | undefined): ParticipantDescriptor | undefined {
  if (!player) return undefined;
  return {
    team: player.team,
    champion: player.championName,
    role: player.role
  };
}

function buildDataAvailability(match: MatchContext): unknown {
  const raw = match.rawLiveData;
  const visualOnly = isVisualOnlyMatch(match);
  return {
    available: [
      visualOnly ? "Visual bookmarks from uploaded VOD/ROFL frames when captured." : "Normalized Riot Live Client snapshots from /liveclientdata/allgamedata.",
      raw ? `Raw Riot /allgamedata payloads: ${raw.includedSnapshots}/${raw.totalStoredSnapshots} stored snapshots included, estimated ${raw.estimatedTokens}/${raw.tokenBudget} raw telemetry tokens.` : undefined,
      "Live Client fields can include active-player championStats, abilities, runes, all-player scores/items/summoner spells, dead/respawn state, and event payloads when Riot supplies them.",
      "Replay API for ROFL can supply replay playback/render metadata and screenshots, but not parsed match-history telemetry by itself."
    ].filter(Boolean),
    sampledNotContinuous: visualOnly
      ? ["Visual frames are sampled bookmarks, not continuous video understanding."]
      : ["Live Client values are sampled at RiftCoach poll times, so HP/resource/dead state is exact only for captured snapshots, not every instant between them."],
    notAvailableUnlessVisualOrExternalApi: [
      "camera intent or player mouse/keyboard input",
      "exact minion/wave positions from Riot telemetry",
      "exact enemy pathing between sampled events",
      "exact ability casts/cooldowns unless present in supplied raw data or visible in a bookmark",
      "public Match-V5 post-game match/timeline data unless a Riot API key and match id path are explicitly configured and supplied"
    ],
    warnings: raw?.warnings ?? []
  };
}

function buildRawRiotLiveClientPacket(
  raw: RawLiveDataTelemetry | undefined,
  options: { includeRawPayloads: boolean }
): unknown {
  if (!raw) return undefined;
  if (!options.includeRawPayloads) {
    return {
      source: raw.source,
      endpoint: raw.endpoint,
      tokenBudget: raw.tokenBudget,
      estimatedTokens: raw.estimatedTokens,
      totalStoredSnapshots: raw.totalStoredSnapshots,
      includedSnapshots: raw.includedSnapshots,
      omittedSnapshots: raw.omittedSnapshots,
      selectionReason: raw.selectionReason,
      rawPayloadsOmitted:
        "Raw /allgamedata payloads are only inserted into the prompt for local Ollama with privacyMode local-only. Switch to local Ollama + local-only privacy to expose the raw Riot JSON to the model.",
      warnings: raw.warnings
    };
  }
  return raw;
}

function summarizeAbilities(details: ActivePlayerDetailsSnapshot | undefined): Array<{ slot: string; name?: string; level?: number; id?: string }> | undefined {
  const abilities = details?.abilities;
  if (!abilities?.length) return undefined;
  return abilities.map((ability: NonNullable<ActivePlayerDetailsSnapshot["abilities"]>[number]) => ({
    slot: ability.slot,
    name: ability.displayName,
    level: ability.abilityLevel,
    id: ability.id
  }));
}

function summarizeRunes(runes: ActivePlayerDetailsSnapshot["runes"] | undefined):
  | {
      keystone?: string;
      primary?: string;
      secondary?: string;
      general?: string[];
      statRunes?: string[];
    }
  | undefined {
  if (!runes) return undefined;
  const general = runes.generalRunes?.map((rune: NonNullable<NonNullable<ActivePlayerDetailsSnapshot["runes"]>["generalRunes"]>[number]) => rune.displayName ?? rune.rawDescription ?? String(rune.id ?? "")).filter(Boolean);
  const statRunes = runes.statRunes?.map((rune: NonNullable<NonNullable<ActivePlayerDetailsSnapshot["runes"]>["statRunes"]>[number]) => rune.displayName ?? rune.rawDescription ?? String(rune.id ?? "")).filter(Boolean);
  const out = {
    keystone: runes.keystone?.displayName ?? runes.keystone?.rawDescription,
    primary: runes.primaryRuneTree?.displayName ?? runes.primaryRuneTree?.rawDescription,
    secondary: runes.secondaryRuneTree?.displayName ?? runes.secondaryRuneTree?.rawDescription,
    general,
    statRunes
  };
  return Object.values(out).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)) ? out : undefined;
}

function formatStatPair(current: number | undefined, max: number | undefined): string | undefined {
  if (typeof current !== "number" && typeof max !== "number") return undefined;
  if (typeof current === "number" && typeof max === "number") return `${Math.round(current)}/${Math.round(max)}`;
  if (typeof current === "number") return `${Math.round(current)}/unknown`;
  return `unknown/${Math.round(max!)}`;
}

function formatResource(stats: ActivePlayerDetailsSnapshot["championStats"] | undefined): string | undefined {
  if (!stats) return undefined;
  const pair = formatStatPair(stats.resourceValue, stats.resourceMax);
  if (!pair) return undefined;
  return `${pair}${stats.resourceType ? ` ${stats.resourceType}` : ""}`;
}

function summarizeCoreStats(stats: ActivePlayerDetailsSnapshot["championStats"] | undefined): Record<string, number> | undefined {
  if (!stats) return undefined;
  const out: Record<string, number> = {};
  const keys = ["attackDamage", "abilityPower", "armor", "magicResist", "attackSpeed", "moveSpeed", "abilityHaste"] as const;
  for (const key of keys) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = rounded(value) ?? value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function itemNames(items: Array<{ displayName: string }>): string[] {
  return items.map((item) => item.displayName).filter(Boolean).slice(0, 7);
}

function compactSummonerSpells(spells: string[] | undefined): string[] {
  const known = ["Flash", "Teleport", "Ignite", "Smite", "Heal", "Barrier", "Exhaust", "Cleanse", "Ghost", "Clarity", "Mark", "Dash"];
  const out: string[] = [];
  for (const spell of spells ?? []) {
    const match = known.find((name) => spell.toLowerCase().includes(name.toLowerCase()));
    if (match && !out.includes(match)) out.push(match);
    if (out.length >= 2) break;
  }
  return out;
}

function inferSnapshotCadence(snapshots: NormalizedSnapshot[]): string | undefined {
  if (snapshots.length < 2) return undefined;
  const gaps = snapshots.slice(1).map((snapshot, index) => snapshot.timestampSec - snapshots[index]!.timestampSec).filter((gap) => gap > 0);
  if (gaps.length === 0) return undefined;
  const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return `about ${rounded(average)}s`;
}

function teamKills(snapshot: NormalizedSnapshot, team: NormalizedPlayerSnapshot["team"]): number | undefined {
  if (!snapshot.allPlayers?.length || team === "UNKNOWN") return undefined;
  return snapshot.allPlayers.filter((player) => player.team === team).reduce((sum, player) => sum + player.scores.kills, 0);
}

function enemyTeamKills(snapshot: NormalizedSnapshot, team: NormalizedPlayerSnapshot["team"]): number | undefined {
  if (!snapshot.allPlayers?.length || team === "UNKNOWN") return undefined;
  return snapshot.allPlayers.filter((player) => player.team !== team && player.team !== "UNKNOWN").reduce((sum, player) => sum + player.scores.kills, 0);
}

function csPerMin(creepScore: number, timestampSec: number): number {
  if (timestampSec <= 0) return 0;
  return rounded((creepScore / timestampSec) * 60) ?? 0;
}

function scoreLine(scores: { kills: number; deaths: number; assists: number }): string {
  return `${scores.kills}/${scores.deaths}/${scores.assists}`;
}

function teamOrder(team: NormalizedPlayerSnapshot["team"]): number {
  if (team === "ORDER") return 0;
  if (team === "CHAOS") return 1;
  return 2;
}

function sampleEvenly<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  if (limit <= 1) return values.slice(0, limit);
  const out: T[] = [];
  const step = (values.length - 1) / (limit - 1);
  const seen = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * step);
    if (seen.has(sourceIndex)) continue;
    seen.add(sourceIndex);
    out.push(values[sourceIndex]!);
  }
  return out;
}

function rounded(value: number | undefined, digits = 2): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Number(value.toFixed(digits));
}

function buildCasualModeMessages(input: CoachReportInput): Array<{ role: "system" | "user"; content: string }> {
  const reason = casualGameReason(input.match.game);
  const label = casualGameLabel(reason);
  const packet = buildCoachPacket(input) as Record<string, unknown>;
  return [
    {
      role: "system",
      content: [
        "You are RiftCoach, but this match was not a laned Summoner's Rift coaching game.",
        `The detected mode is ${label}. Do not infer lane, role, matchup, CS benchmarks, macro lessons, or improvement drills.`,
        toneInstruction(input.settings.coachTone),
        "Return a short, witty, kind post-game comment and explicitly mark that coaching was skipped for this mode.",
        "Return strict JSON matching the provided schema."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          ...packet,
          instruction: {
            requiredOutput:
              "Return only JSON with keys reviewType, summary, mainMistake, positiveHabit, timelineNotes, nextGameDrill, warnings. Set reviewType to casual_mode. Do not provide tips, coaching steps, replay bookmarks, or a real drill.",
            fieldGuidance: {
              summary: `One or two witty sentences about the ${label} game.`,
              mainMistake:
                "Use title 'No lane review for this mode'. Explanation should say lane coaching was skipped, not that the player made a mistake. Evidence should cite the supplied game mode/map evidence.",
              positiveHabit: "A playful compliment about surviving the chaos.",
              timelineNotes: "Use an empty array.",
              nextGameDrill: "Use title 'No drill for this mode', empty steps, and a successMetric that says there is no coaching metric for this mode.",
              warnings: [`Coaching skipped because ${label} does not have stable lane assignments for RiftCoach analysis.`]
            }
          }
        }
      )
    }
  ];
}
