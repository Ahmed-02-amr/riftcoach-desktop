const CHAMPION_DISPLAY_NAMES: Record<string, string> = {
  Chogath: "Cho'Gath",
  DrMundo: "Dr. Mundo",
  JarvanIV: "Jarvan IV",
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KSante: "K'Sante",
  Leblanc: "LeBlanc",
  MonkeyKing: "Wukong",
  Nunu: "Nunu & Willump",
  Renata: "Renata Glasc",
  Velkoz: "Vel'Koz"
};

export function formatChampionName(value?: string): string {
  const name = value?.trim();
  if (!name) return "Unknown champion";
  return CHAMPION_DISPLAY_NAMES[name] ?? name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}
