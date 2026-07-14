import type { CoachInsight, CoachReport, CoachReportInput, InsightCategory } from "@riftcoach/core";
import { formatChampionName, formatTime, isCasualReviewMode } from "@riftcoach/core";
import { isFinalStatsOnlyRoflMatch, isVisualOnlyMatch } from "./evidence-mode";

const DECISION_CATEGORIES = new Set<InsightCategory>([
  "laning",
  "positioning",
  "objective_control",
  "macro",
  "teamfighting",
  "jungle_tempo",
  "support_roaming",
  "itemization",
  "visual_review"
]);

const BENCHMARK_ONLY_PATTERNS = [
  /\bbenchmark/i,
  /relative to benchmarks/i,
  /performance was hindered/i,
  /significant (?:farming |cs |vision )?deficit/i,
  /gold disadvantage/i,
  /excessive deaths/i,
  /decent vision control/i,
  /below (?:your )?role target/i
];

const ACTION_VERBS = /\b(check|hold|drop|crash|recall|ward|ping|wait|push|catch|trade|contest|group|reset|path|kite|freeze|thin|slow push|base|hover|track)\b/i;

export function enforceActionableCoachReport(report: CoachReport, input: CoachReportInput): CoachReport {
  if (report.reviewType === "casual_mode" || isCasualReviewMode(input.match.game)) return report;

  const focus = chooseActionFocus(input);
  if (!focus) return report;

  const needsMainRepair = isBenchmarkOnlyReview(report) || !hasConcreteMainMistake(report);
  const needsDrillRepair = !hasActionableDrill(report);

  if (!needsMainRepair && !needsDrillRepair) return report;

  const action = actionPlanForInsight(focus, input);
  return {
    ...report,
    summary: needsMainRepair ? buildSummary(focus, action, input) : report.summary,
    mainMistake: needsMainRepair ? buildMainMistake(focus, action, input) : report.mainMistake,
    timelineNotes: report.timelineNotes.length > 0 ? report.timelineNotes : buildTimelineNotes(focus, action),
    nextGameDrill: needsDrillRepair || needsMainRepair ? buildDrill(action) : report.nextGameDrill
  };
}

const SYSTEM_HABIT_PATTERN = /\b(parse[dr]?|metadata|telemetry|import(?:ed)?|role identification|capture[dr]?|system reliability)\b/i;
const FINAL_STATS_WARNING =
  "Offline ROFL review used final-scoreboard metadata only. Without Match-v5 timeline data or replay frames, RiftCoach cannot verify when or why each outcome happened.";

const ROLE_BASELINES: Record<string, { csPerMin: number; visionPerMin: number; killParticipation: number }> = {
  top: { csPerMin: 6.2, visionPerMin: 0.48, killParticipation: 0.3 },
  jungle: { csPerMin: 5.1, visionPerMin: 0.72, killParticipation: 0.45 },
  mid: { csPerMin: 6.5, visionPerMin: 0.52, killParticipation: 0.35 },
  adc: { csPerMin: 6.8, visionPerMin: 0.42, killParticipation: 0.35 },
  support: { csPerMin: 0.8, visionPerMin: 1.35, killParticipation: 0.45 },
  unknown: { csPerMin: 5.8, visionPerMin: 0.62, killParticipation: 0.35 }
};

/**
 * Keeps system/import status out of coaching content and constrains scoreboard-only
 * ROFL reviews to claims supported by the final metadata envelope.
 */
export function enforceEvidenceBackedCoachReport(report: CoachReport, input: CoachReportInput): CoachReport {
  if (report.reviewType === "casual_mode" || isCasualReviewMode(input.match.game)) return report;
  if (isFinalStatsOnlyRoflMatch(input.match)) return buildFinalStatsOnlyRoflReport(report, input);
  if (!SYSTEM_HABIT_PATTERN.test(`${report.positiveHabit.title}\n${report.positiveHabit.explanation}`)) return report;
  return { ...report, positiveHabit: deriveFinalStatsStrength(input) };
}

function buildFinalStatsOnlyRoflReport(report: CoachReport, input: CoachReportInput): CoachReport {
  const champion = formatChampionName(input.match.player.championName);
  const latest = [...input.match.snapshots].sort((a, b) => a.timestampSec - b.timestampSec).at(-1);
  const durationSec = Math.max(1, input.match.aggregate.durationSec);
  const durationMin = durationSec / 60;
  const score = input.match.aggregate;
  const cs = latest?.scores.creepScore ?? Math.round(score.csPerMin * durationMin);
  const vision = score.visionScore;
  const positiveHabit = deriveFinalStatsStrength(input);
  const focus = deriveFinalStatsFocus(input);
  const scoreboard = `${champion} ${score.kills}/${score.deaths}/${score.assists}, ${cs} CS${typeof vision === "number" ? `, ${vision} vision` : ""} in ${formatTime(durationSec)}`;
  const warnings = report.warnings.filter((warning) => !/visual-only|no Riot Live Client scoreboard|visual bookmarks|metadata envelope parsing/i.test(warning));

  return {
    ...report,
    summary:
      `${scoreboard}. ${positiveHabit.title} is the clearest supported strength, while ${focus.mainMistake.title.toLocaleLowerCase()} is the clearest next-game focus. ` +
      "This import has final stats but no event timeline, so RiftCoach will not invent the wave state, pathing, positioning, or exact decisions behind those numbers.",
    mainMistake: focus.mainMistake,
    positiveHabit,
    timelineNotes: [],
    nextGameDrill: focus.nextGameDrill,
    warnings: [...warnings, ...(warnings.includes(FINAL_STATS_WARNING) ? [] : [FINAL_STATS_WARNING])]
  };
}

function deriveFinalStatsStrength(input: CoachReportInput): CoachReport["positiveHabit"] {
  const match = input.match;
  const champion = formatChampionName(match.player.championName);
  const role = match.player.role ?? "unknown";
  const baseline = ROLE_BASELINES[role] ?? ROLE_BASELINES.unknown!;
  const durationMin = Math.max(1, match.aggregate.durationSec / 60);
  const latest = [...match.snapshots].sort((a, b) => a.timestampSec - b.timestampSec).at(-1);
  const cs = latest?.scores.creepScore ?? Math.round(match.aggregate.csPerMin * durationMin);
  const vision = match.aggregate.visionScore;
  const visionPerMin = typeof vision === "number" ? vision / durationMin : undefined;
  const teamKills = match.aggregate.teamKills;
  const participation = teamKills ? (match.aggregate.kills + match.aggregate.assists) / teamKills : undefined;

  if (role !== "support" && match.aggregate.csPerMin >= baseline.csPerMin) {
    return {
      title: `Maintained ${role === "unknown" ? "resource" : role} farm pace`,
      explanation:
        `${champion} finished with ${cs} CS in ${formatTime(match.aggregate.durationSec)}, or ${match.aggregate.csPerMin.toFixed(1)} CS per minute. ` +
        `That meets RiftCoach's built-in ${role === "unknown" ? "role" : role} median, making resource collection the clearest positive signal available from the final scoreboard.`
    };
  }
  if (visionPerMin !== undefined && visionPerMin >= baseline.visionPerMin) {
    return {
      title: "Contributed useful vision",
      explanation:
        `${champion} recorded ${vision} vision score in ${formatTime(match.aggregate.durationSec)} (${visionPerMin.toFixed(2)} per minute). ` +
        `That meets RiftCoach's built-in ${role === "unknown" ? "role" : role} median and is the strongest supported positive from the final stats.`
    };
  }
  if (match.aggregate.deaths <= 2) {
    return {
      title: "Protected the death budget",
      explanation: `${champion} finished with ${match.aggregate.deaths} deaths in ${formatTime(match.aggregate.durationSec)}. The final scoreboard supports survival as the clearest positive, though it cannot show the decisions that produced it.`
    };
  }
  if (participation !== undefined && participation >= baseline.killParticipation) {
    return {
      title: "Contributed to team takedowns",
      explanation: `${champion} contributed ${match.aggregate.kills + match.aggregate.assists} takedowns across ${teamKills} team kills (${Math.round(participation * 100)}%). That involvement is the clearest positive supported by the final scoreboard.`
    };
  }
  return {
    title: "Kept collecting resources",
    explanation: `${champion} finished with ${cs} CS in ${formatTime(match.aggregate.durationSec)}. No stronger positive clears a role-adjusted threshold in the final stats, so RiftCoach is keeping this signal modest instead of inventing praise.`
  };
}

function deriveFinalStatsFocus(input: CoachReportInput): Pick<CoachReport, "mainMistake" | "nextGameDrill"> {
  const match = input.match;
  const champion = formatChampionName(match.player.championName);
  const role = match.player.role ?? "unknown";
  const baseline = ROLE_BASELINES[role] ?? ROLE_BASELINES.unknown!;
  const durationMin = Math.max(1, match.aggregate.durationSec / 60);
  const deathsPerTen = (match.aggregate.deaths / durationMin) * 10;
  const latest = [...match.snapshots].sort((a, b) => a.timestampSec - b.timestampSec).at(-1);
  const cs = latest?.scores.creepScore ?? Math.round(match.aggregate.csPerMin * durationMin);
  const vision = match.aggregate.visionScore;
  const visionPerMin = typeof vision === "number" ? vision / durationMin : undefined;
  const teamKills = match.aggregate.teamKills;
  const participation = teamKills ? (match.aggregate.kills + match.aggregate.assists) / teamKills : undefined;
  const scoreboardEvidence = `Final scoreboard: ${champion} ${match.aggregate.kills}/${match.aggregate.deaths}/${match.aggregate.assists}, ${cs} CS${typeof vision === "number" ? `, ${vision} vision` : ""} in ${formatTime(match.aggregate.durationSec)}.`;
  const limitation = "Final-only ROFL metadata has no event timing, so it cannot identify the cause of this result.";

  if (match.aggregate.deaths >= 6 || deathsPerTen >= 2.5) {
    const targetDeaths = Math.max(3, match.aggregate.deaths - 2);
    return {
      mainMistake: {
        title: "Reduce repeat deaths",
        explanation:
          `${champion} recorded ${match.aggregate.deaths} deaths in ${formatTime(match.aggregate.durationSec)}, or ${deathsPerTen.toFixed(1)} deaths per 10 minutes. ` +
          "That is the largest controllable cost visible in the final scoreboard. The metadata cannot tell whether those deaths came from invades, objective fights, side lanes, or late re-entries, so the coaching claim stops at the supported signal: protect more of your time on the map.",
        evidence: [scoreboardEvidence, `Death rate: ${deathsPerTen.toFixed(1)} per 10 minutes.`, limitation],
        whyItMatters: "Every death removes farming, vision, and objective time while giving the opposing team gold and tempo. Cutting two deaths is a concrete way to preserve more opportunities without pretending the final scoreboard explains each mistake."
      },
      nextGameDrill: {
        title: "One-check-before-commit drill",
        steps: [
          "Before entering a fight or unwarded area, confirm that at least one teammate is in range to follow up.",
          "After every death, take one safe camp, wave, or reset before returning to the same contested area.",
          "If your exit route and nearby ally positions are both unclear, disengage and keep your map time."
        ],
        successMetric: `Finish the next game with no more than ${targetDeaths} deaths.`,
        duration: "next_game"
      }
    };
  }

  if (participation !== undefined && teamKills! >= 6 && participation < baseline.killParticipation) {
    return {
      mainMistake: {
        title: "Increase useful fight involvement",
        explanation: `${champion} contributed ${match.aggregate.kills + match.aggregate.assists} takedowns across ${teamKills} team kills (${Math.round(participation * 100)}%). The final scoreboard supports low involvement as a focus, but it does not show whether the cause was pathing, timing, or fight selection.`,
        evidence: [scoreboardEvidence, `Kill participation: ${Math.round(participation * 100)}%.`, limitation],
        whyItMatters: "Your role needs to convert map time into fights, pressure, or objectives. Raising useful involvement gives your farming and vision a clearer payoff."
      },
      nextGameDrill: {
        title: "Plan the next map window",
        steps: [
          "After each recall, choose the next lane, objective, or teammate you can realistically support.",
          "Ping your intended move before leaving your current camp or wave.",
          "If no play is available, keep farming on tempo instead of arriving late to a finished fight."
        ],
        successMetric: `Reach at least ${Math.round(baseline.killParticipation * 100)}% kill participation in the next game.`,
        duration: "next_game"
      }
    };
  }

  if (visionPerMin !== undefined && visionPerMin < baseline.visionPerMin * 0.75) {
    return {
      mainMistake: {
        title: "Raise vision coverage",
        explanation: `${champion} recorded ${vision} vision score in ${formatTime(match.aggregate.durationSec)} (${visionPerMin.toFixed(2)} per minute). That is the clearest below-baseline final-stat signal for ${role}.`,
        evidence: [scoreboardEvidence, `Vision rate: ${visionPerMin.toFixed(2)} per minute.`, limitation],
        whyItMatters: "More useful vision protects map time and gives your team better information before committing to contested areas."
      },
      nextGameDrill: {
        title: "Ward before the danger line",
        steps: [
          "Place vision before crossing river or entering objective fog.",
          "On each recall after 8:00, buy a control ward when inventory and gold allow it.",
          "Replace expired vision before the next major objective instead of after contact starts."
        ],
        successMetric: `Reach at least ${Math.ceil(baseline.visionPerMin * durationMin)} vision score in a game of similar length.`,
        duration: "next_game"
      }
    };
  }

  return {
    mainMistake: {
      title: "Convert stable stats into more impact",
      explanation: `${champion}'s final scoreboard does not contain one severe role-adjusted outlier beyond the listed totals. Without a timeline or replay frames, RiftCoach cannot responsibly name a specific decision mistake, so the focus is to turn stable resource collection into a higher takedown contribution next game.`,
      evidence: [scoreboardEvidence, limitation],
      whyItMatters: "Stable fundamentals matter most when they create pressure, takedowns, or objective control. A measurable involvement target keeps the next review honest."
    },
    nextGameDrill: {
      title: "Name the next contribution",
      steps: [
        "After every recall, choose one concrete contribution: farm a full route, cover a teammate, or prepare the next objective.",
        "Ping that intention before moving so the team can respond.",
        "After the play, return to the next safe resource instead of drifting without a plan."
      ],
      successMetric: "Record at least one more kill or assist than the previous game while keeping deaths no higher.",
      duration: "next_game"
    }
  };
}

function chooseActionFocus(input: CoachReportInput): CoachInsight | undefined {
  const insights = input.insights ?? [];
  if (isVisualOnlyReview(input)) return insights[0];
  return insights.find((insight) => DECISION_CATEGORIES.has(insight.category)) ?? insights[0];
}

function isVisualOnlyReview(input: CoachReportInput): boolean {
  return isVisualOnlyMatch(input.match);
}

function isBenchmarkOnlyReview(report: CoachReport): boolean {
  const text = [
    report.summary,
    report.mainMistake.title,
    report.mainMistake.explanation,
    report.mainMistake.whyItMatters,
    report.nextGameDrill.title,
    ...report.nextGameDrill.steps
  ].join("\n");
  return BENCHMARK_ONLY_PATTERNS.some((pattern) => pattern.test(text));
}

function hasConcreteMainMistake(report: CoachReport): boolean {
  const text = `${report.mainMistake.title}\n${report.mainMistake.explanation}\n${report.mainMistake.whyItMatters}`;
  const citesEvidence = report.mainMistake.evidence.length > 0;
  const hasTimestampOrTrigger = /\b\d{1,2}:\d{2}\b|\bbefore\b|\bafter\b|\bwhen\b|\bwave\b|\bobjective\b|\bdeath\b|\brecall\b|\bvision\b/i.test(text);
  return citesEvidence && hasTimestampOrTrigger && ACTION_VERBS.test(text);
}

function hasActionableDrill(report: CoachReport): boolean {
  if (report.nextGameDrill.steps.length < 2) return false;
  const stepText = report.nextGameDrill.steps.join("\n");
  const hasTrigger = /\b(before|after|when|every|if|at \d{1,2}:?\d{0,2}|next wave|recall|objective|river|death)\b/i.test(stepText);
  const hasMetric = /\b\d+|zero|no more than|at least|within|before|per\b/i.test(report.nextGameDrill.successMetric);
  return hasTrigger && hasMetric && ACTION_VERBS.test(stepText);
}

type ActionPlan = {
  title: string;
  summary: string;
  correction: string;
  consequence: string;
  steps: string[];
  successMetric: string;
  duration: CoachReport["nextGameDrill"]["duration"];
};

function actionPlanForInsight(insight: CoachInsight, input: CoachReportInput): ActionPlan {
  switch (insight.category) {
    case "laning":
      return {
        title: "Stop taking the first doomed lane fight",
        summary:
          "Your next-game focus is lane restraint before 10:00. Take trades only when the wave, jungle information, and escape route are good enough; otherwise give the contested minion and keep the lane playable.",
        correction: "Before trading in lane, check wave size, enemy jungle threat, and your escape cooldown. If two are bad or unknown, give the CS and keep the wave playable.",
        consequence: "One bad early trade turns into lost wave control, worse recall timing, and a lane where every next CS costs health.",
        steps: [
          "Before each trade before 10:00, check: is my wave bigger, do I know enemy jungle, and do I have Flash or a clean exit?",
          "If two checks fail, drop the contested minion and hold the wave closer to your tower.",
          "Only trade after the enemy uses a key cooldown or after your wave is large enough to punish them back."
        ],
        successMetric: "Finish the next game with zero avoidable deaths before 10:00 while staying within one wave of your lane opponent.",
        duration: "next_3_games"
      };
    case "positioning":
      return {
        title: "Take the safe reset after a death",
        summary:
          "Your next-game focus is stopping the second death, not explaining the first one. After you die, use the next two minutes to rebuild from safe waves, camps, and vision before you re-enter the same contested area.",
        correction: "After a death, spend the next two minutes rebuilding tempo through safe waves, camps, and vision instead of sprinting back into the same fight line.",
        consequence: "Repeated deaths in the same window turn one mistake into a map-wide timer loss for your team.",
        steps: [
          "After every death, path to the nearest safe wave or camp before looking at a fight.",
          "Do not cross river until you see teammates near you or have vision on the likely threat.",
          "Ping danger and give the next low-value contest if your wave is not pushed."
        ],
        successMetric: "No back-to-back deaths within four minutes for the next three games.",
        duration: "next_3_games"
      };
    case "objective_control":
      return {
        title: "Enter setup mode before the objective",
        summary:
          "Your next-game focus is objective setup discipline. When a major objective is about a minute away, stop taking random side fights and spend that timer resetting, pushing, warding, and arriving with teammates.",
        correction: "At 60 seconds before dragon, Herald, or Baron, stop gambling on isolated fights and spend the timer on reset, push, vision, and grouping.",
        consequence: "Dying right before an objective removes your team's ability to contest even if the fight looked playable ten seconds earlier.",
        steps: [
          "At 1:00 before a major objective, check whether your wave is pushed and whether you can reset.",
          "Place or refresh vision before crossing into river.",
          "If you cannot arrive with teammates, ping off and trade the opposite side instead of face-checking."
        ],
        successMetric: "Zero deaths in the 60 seconds before major objectives for the next three games.",
        duration: "next_3_games"
      };
    case "jungle_tempo":
      return {
        title: "Arrive to the first map window on purpose",
        summary:
          "Your next-game focus is having a planned first move. Choose your clear direction before minions spawn, recall on time, and arrive to the first fightable lane or objective before the map has already moved without you.",
        correction: "Plan your first clear and recall so your first move is proactive, not a late reaction after lanes are already decided.",
        consequence: "Late first moves give up scuttle, dragon setup, or lane cover without forcing anything back.",
        steps: [
          "Before minions spawn, choose your first clear direction based on which lane can actually fight.",
          "On your first recall, buy and path directly toward the next fightable lane or objective.",
          "If no lane is fightable, full clear on tempo and ping teammates away from bad river fights."
        ],
        successMetric: "By 8:00, create one kill/assist, burned summoner, objective setup, or full-clear tempo lead.",
        duration: "next_3_games"
      };
    case "macro":
    case "teamfighting":
      return {
        title: "Move only after your wave gives permission",
        summary:
          "Your next-game focus is wave permission. Catch or push the wave before you roam or group, so you are not losing guaranteed gold to arrive late for a fight that may not even happen.",
        correction: "Join fights after pushing or catching the wave first. Do not donate a wave and arrive late to a low-odds fight.",
        consequence: "Moving without wave control loses gold even when nothing happens, and it makes every lost fight more expensive.",
        steps: [
          "Before roaming or grouping, check whether the next allied wave will crash into your tower.",
          "If yes, catch or thin it first unless the fight is already guaranteed and nearby.",
          "After pushing, move through warded paths and ping your timing before committing."
        ],
        successMetric: "For the next game, miss no more than one full wave to a roam or fight that does not produce a kill, assist, or objective.",
        duration: "next_game"
      };
    case "itemization":
      return {
        title: "Recall when your gold can become power",
        summary:
          "Your next-game focus is turning gold into combat power before the next risky play. When a pushed wave or objective timer gives you a clean base, spend the gold instead of staying out for one more low-value trade.",
        correction: "Stop staying on the map with spendable gold when the next wave or objective timer gives you a clean base.",
        consequence: "Delayed item spikes make every later fight harder even if your mechanics are fine.",
        steps: [
          "After pushing a wave, check whether you can buy a component or completed item.",
          "If you can buy, recall before taking another low-value trade.",
          "Return to lane or objective setup with the item instead of fighting on unspent gold."
        ],
        successMetric: "Buy your first major component before the next risky fight or objective contest.",
        duration: "next_game"
      };
    case "vision":
      return {
        title: "Ward before you cross the danger line",
        summary:
          "Your next-game focus is warding before the risky step, not after danger appears. If you are about to push past river or walk into objective fog, place vision first or wait for a teammate.",
        correction: "Place vision before pushing past river or walking into objective fog, not after the threat is already on your screen.",
        consequence: "Late wards do not prevent the death that already started.",
        steps: [
          "Before pushing past river, place a ward on the path the enemy jungler or roamer would use.",
          "On every recall after 8:00, buy a control ward if your inventory and gold allow it.",
          "Do not face-check objective fog without a teammate nearby or a scouting tool."
        ],
        successMetric: "Place vision before crossing river at least four times in the next game and avoid dying to an unseen collapse.",
        duration: "next_game"
      };
    case "cs": {
      const csAt10 = input.match.aggregate.csAt10;
      const target = typeof csAt10 === "number" ? Math.max(csAt10 + 8, 55) : 60;
      return {
        title: "Catch the safe wave before chasing the play",
        summary:
          "Your next-game focus is wave discipline. Before you leave lane, trade, or walk toward river, check whether the next wave is safe and collectable; take the guaranteed wave first unless the nearby play is immediate and clearly winning.",
        correction: "Low CS usually comes from repeated wave choices, not one missed last-hit. Choose the guaranteed wave before low-probability trades, roams, or river walks.",
        consequence: "Missing two waves removes the gold you need to survive the next fight, then the lane gets harder for reasons that look like mechanics.",
        steps: [
          "Before leaving lane, check whether a wave is about to reach your tower.",
          "If yes, catch that wave first unless the nearby fight is already winning and immediate.",
          "When pressured, give the dangerous ranged minions but stay in XP range instead of dying for them."
        ],
        successMetric: `Reach at least ${Math.round(target)} CS by 10:00 in the next game without taking an avoidable lane death.`,
        duration: "next_game"
      };
    }
    case "support_roaming":
      return {
        title: "Roam only after your lane is released",
        summary:
          "Your next-game focus is roam timing. Leave bot only after the wave is crashed, safe, or bouncing back, so your move creates pressure without donating your own lane.",
        correction: "Move after your ADC can farm safely or after the wave is crashed, not while your lane is still vulnerable.",
        consequence: "A mistimed roam loses bot pressure and can give the enemy a free crash or dive.",
        steps: [
          "Before roaming, check whether bot wave is crashed, frozen safely, or bouncing back to you.",
          "Ping your roam path and move through warded river or jungle entrances.",
          "If the roam cannot arrive before the play starts, return bot and protect the wave."
        ],
        successMetric: "For the next game, every roam starts after a crashed/safe wave or creates a kill, summoner, objective, or deep vision.",
        duration: "next_game"
      };
    case "visual_review":
    case "training_goal":
    default:
      return {
        title: "Replay the bookmark as a decision check",
        summary:
          "Your next-game focus is turning the replay bookmark into an in-game trigger. When the same map state appears, name the threat and choose the safer path before the play collapses.",
        correction: "Use the bookmarked moment to name the decision you made, the information you had, and the safer alternative before the fight or wave collapsed.",
        consequence: "A visual review is useful only if it becomes a repeatable in-game trigger, not just a screenshot of something going wrong.",
        steps: [
          "When the same map state appears, pause mentally and name the threat before moving forward.",
          "Choose the lower-risk option if teammate position, wave state, or vision is unclear.",
          "After the play, check whether the decision followed the trigger instead of judging only the result."
        ],
        successMetric: "In the next review, identify three similar moments and make the safer choice in at least two of them.",
        duration: "next_3_games"
      };
  }
}

function buildSummary(insight: CoachInsight, action: ActionPlan, input: CoachReportInput): string {
  const subject = input.match.player.championName ?? "Your game";
  return `${subject}: ${action.summary}`;
}

function buildMainMistake(insight: CoachInsight, action: ActionPlan, input: CoachReportInput): CoachReport["mainMistake"] {
  const timestamps = insight.affectedTimestamps.map(formatTime).join(", ");
  const timeText = timestamps ? ` around ${timestamps}` : "";
  return {
    title: action.title,
    explanation: `${insight.title}${timeText} is the clearest signal for this review. ${action.correction}`,
    evidence: buildEvidence(insight, input),
    whyItMatters: action.consequence
  };
}

function buildTimelineNotes(insight: CoachInsight, action: ActionPlan): CoachReport["timelineNotes"] {
  const timestamps = insight.affectedTimestamps.length > 0 ? insight.affectedTimestamps : [10 * 60];
  return timestamps.slice(0, 3).map((timestampSec) => ({
    timestampSec,
    title: action.title,
    note: `${insight.title}: ${firstSentence(action.correction)}`
  }));
}

function buildDrill(action: ActionPlan): CoachReport["nextGameDrill"] {
  return {
    title: action.title,
    steps: action.steps,
    successMetric: action.successMetric,
    duration: action.duration
  };
}

function buildEvidence(insight: CoachInsight, input: CoachReportInput): string[] {
  const evidence = new Set<string>();
  for (const entry of insight.evidence) evidence.add(entry);

  const telemetryEvidence = collectTelemetryEvidence(input).filter((entry) => !/target estimate|benchmark|role target/i.test(entry));
  for (const entry of telemetryEvidence.slice(0, 3)) evidence.add(entry);

  return Array.from(evidence).slice(0, 5);
}

function collectTelemetryEvidence(input: CoachReportInput): string[] {
  const latest = [...input.match.snapshots].sort((a, b) => a.timestampSec - b.timestampSec).at(-1);
  const out: string[] = [];
  if (latest) {
    out.push(
      `Final scoreboard: ${input.match.player.championName} ${input.match.aggregate.kills}/${input.match.aggregate.deaths}/${input.match.aggregate.assists} with ${latest.scores.creepScore} CS at ${formatTime(latest.timestampSec)}.`
    );
  }
  if (input.match.aggregate.deathTimestamps.length > 0) {
    out.push(`Death timestamps: ${input.match.aggregate.deathTimestamps.map(formatTime).join(", ")}.`);
  }
  const combat = input.match.events
    .filter((event) => event.type === "champion_kill")
    .slice(0, 4)
    .map((event) => `${formatTime(event.timestampSec)} ${event.actorName ?? "unknown"} killed ${event.victimName ?? "unknown"}`)
    .join("; ");
  if (combat) out.push(`Combat timeline: ${combat}.`);
  return out;
}

function firstSentence(text: string): string {
  const sentence = text.match(/^[^.!?]+[.!?]/)?.[0];
  return sentence ?? text;
}
