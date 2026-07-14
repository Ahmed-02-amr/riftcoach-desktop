import type { CoachChatInput, CoachTone, KnowledgeSourceSnippet } from "@riftcoach/core";
import { buildCoachPacket } from "./prompt-builder";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function buildReviewChatMessages(input: CoachChatInput): ChatMessage[] {
  const history = input.history.slice(-12).map((message): ChatMessage => ({
    role: message.role,
    content: message.content
  }));

  return [
    {
      role: "system",
      content: [
        "You are RiftCoach's review companion for a League of Legends player.",
        "Your job is to help the player decide the best next course of action after a saved post-game review.",
        "Use the supplied report, match evidence, visual bookmarks, and chat history as ground truth.",
        "If the previous report sounds generic, reframe it into concrete decisions, triggers, and next-game habits instead of defending the wording.",
        "Do not invent scoreboard, matchup, build, hidden enemy position, replay facts, Riot API endpoints, or Riot API fields that are not supplied.",
        "When matchEvidence.telemetry.rawRiotLiveClient contains raw payloads, inspect them as raw Riot /liveclientdata/allgamedata snapshots. When they are omitted, say they are omitted instead of pretending to have them.",
        "Treat Live Client data as sampled snapshots. Do not claim exact HP, cooldowns, wave state, camera position, or ability casts unless supplied by a near timestamped raw snapshot or visual bookmark.",
        "Do not tell the player Riot exposes camera position, wave state, exact pathing, or HP-at-death through a normal post-game endpoint unless that exact data is present in matchEvidence.",
        "Do not make benchmark deltas the answer by themselves. Treat stats as symptoms and explain the decision pattern behind them.",
        "When web snippets are supplied, use them only for current/general League context and say when the match evidence is stronger than the web context.",
        "Give a direct answer first. Then give an actionable plan the player can try in the next match.",
        "Prefer specifics: game timer triggers, wave states, recall/fight/objective decisions, camera/minimap checks, and measurable success criteria.",
        "Ask at most one clarifying question, and only when the best action truly cannot be chosen from the evidence.",
        "Keep the answer conversational and useful. It can be several paragraphs when needed.",
        toneInstruction(input.settings.coachTone)
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(buildReviewChatPacket(input))
    },
    ...history,
    {
      role: "user",
      content: input.userMessage
    }
  ];
}

function buildReviewChatPacket(input: CoachChatInput): unknown {
  return {
    review: {
      id: input.report.id,
      createdAtIso: input.report.createdAtIso,
      reviewType: input.report.reviewType ?? "coaching",
      summary: input.report.summary,
      mainMistake: input.report.mainMistake,
      positiveHabit: input.report.positiveHabit,
      timelineNotes: input.report.timelineNotes,
      nextGameDrill: input.report.nextGameDrill,
      warnings: input.report.warnings
    },
    matchEvidence: buildCoachPacket({
      match: input.match,
      insights: input.insights,
      profile: input.profile,
      settings: input.settings,
      knowledge: input.knowledge
    }),
    freshWebContext: formatWebSources(input.webSources ?? []),
    webWarnings: input.webWarnings ?? [],
    instruction: {
      requiredAnswer:
        "Answer the player's latest message. Recommend the best next action, explain why it fits the supplied evidence, and give a concrete next-game plan with a countable success check.",
      avoid: [
        "benchmark-only answers",
        "vague report-card phrasing",
        "telling the player to simply farm better, die less, ward more, or review the replay without exact triggers",
        "claiming current patch facts unless they are in freshWebContext"
      ]
    }
  };
}

function formatWebSources(sources: KnowledgeSourceSnippet[]): Array<{
  title: string;
  url: string;
  snippet: string;
  query: string;
  reliability: KnowledgeSourceSnippet["reliability"];
}> {
  return sources.map((source) => ({
    title: source.title,
    url: source.url,
    snippet: source.snippet,
    query: source.query,
    reliability: source.reliability
  }));
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
