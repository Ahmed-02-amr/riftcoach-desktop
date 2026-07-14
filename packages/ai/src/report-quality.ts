import type { CoachInsight, CoachReport, CoachReportInput, InsightCategory } from "@riftcoach/core";
import { formatTime, isCasualReviewMode } from "@riftcoach/core";

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

function chooseActionFocus(input: CoachReportInput): CoachInsight | undefined {
  const insights = input.insights ?? [];
  if (isVisualOnlyReview(input)) return insights[0];
  return insights.find((insight) => DECISION_CATEGORIES.has(insight.category)) ?? insights[0];
}

function isVisualOnlyReview(input: CoachReportInput): boolean {
  return input.match.game?.gameMode === "VOD_REVIEW" || input.match.game?.gameMode === "ROFL_REPLAY";
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
