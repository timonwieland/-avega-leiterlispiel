export type SpecialAction =
  | "move"
  | "skip"
  | "extraRoll"
  | "doubleNext"
  | "leaderBack"
  | "swapNearest"
  | "start"
  | "goal";

export type FieldConfig = {
  fieldNumber: number;
  date?: string;
  title?: string;
  description?: string;
  illustration?: string;
  fieldType: "normal" | "event" | "goal";
  actionType?: SpecialAction;
  actionLabel?: string;
  targetField?: number;
  movement?: "forward" | "backward";
  connectionVisual?: "ladder" | "snake" | "graphic";
  connectionAsset?: string;
  skipTurns?: number;
  extraRoll?: boolean;
  nextRollMultiplier?: number;
  swapPosition?: boolean;
  specialRule?: string;
  popupEnabled: boolean;
  popupImportance?: "standard" | "high";
  animationType?: "step" | "ladder" | "slide" | "swap" | "celebrate";
};

const events: Record<number, Partial<FieldConfig>> = {
  1: { date: "16. Dezember 2016", title: "Der Anfang", description: "Die avega IT AG wird gegründet. Adresse: Spitalgasse 28, ein Tisch im Impact Hub.", actionType: "start", actionLabel: "Start" },
  3: { date: "Anfang 2017", title: "Feierabendprojekt", description: "Konzepte und Templates entstehen nach Feierabend – tagsüber läuft der alte Job weiter.", actionType: "move", actionLabel: "Zurück auf Feld 1", targetField: 1, movement: "backward", connectionVisual: "snake", connectionAsset: "/assets/snake-3-1.png" },
  5: { date: "April 2017", title: "Jetzt ganz", description: "Paul und Danu steigen ganz ein. Ab jetzt ist avega kein Nebenprojekt mehr.", actionType: "move", actionLabel: "Vor auf Feld 24", targetField: 24, movement: "forward" },
  7: { date: "Mai 2017", title: "Fritschi kommt dazu", description: "Fritschi kommt als Mitarbeitender dazu – die Partnerschaft ist bereits mitgedacht.", actionType: "move", actionLabel: "Vor auf Feld 8", targetField: 8, movement: "forward", connectionVisual: "graphic" },
  11: { date: "Frühling 2017", title: "Viele Gespräche", description: "Viele Gespräche, viel Wohlwollen, kaum Aufträge. Die Hand bleibt ausgestreckt.", actionType: "move", actionLabel: "Zurück auf Feld 6", targetField: 6, movement: "backward", connectionVisual: "snake", connectionAsset: "/assets/snake-11-6.png" },
  15: { date: "Sommer 2017", title: "Das erste Geld", description: "Zum ersten Mal verdient avega Geld.", actionType: "move", actionLabel: "Vor auf Feld 16", targetField: 16, movement: "forward", connectionVisual: "graphic" },
  20: { date: "September 2017", title: "Papierstapel", description: "Der Papierstapel wächst schneller als der Tag lang ist. Es braucht Unterstützung in der Administration.", actionType: "move", actionLabel: "Vor auf Feld 21", targetField: 21, movement: "forward", connectionVisual: "graphic" },
  22: { date: "Februar 2018", title: "Das Team wächst", description: "Patricia startet als erste angestellte Person. Das Licht im Büro brennt jetzt auch, wenn die Gründer unterwegs sind.", actionType: "move", actionLabel: "Vor auf Feld 38", targetField: 38, movement: "forward" },
  25: { date: "Januar 2018", title: "Vom Team zum Teilhaber", description: "Fritschi übernimmt 20 Prozent der Aktien. Aus Mitarbeit wird Teilhaber – darauf wird angestossen.", actionType: "skip", actionLabel: "Einmal aussetzen", skipTurns: 1 },
  29: { title: "Mehr Stühle, bitte", description: "Das Team wächst auf zehn Personen. Es wird eng, es werden Stühle herangeschoben.", actionType: "move", actionLabel: "Vor auf Feld 31", targetField: 31, movement: "forward", connectionVisual: "graphic" },
  34: { title: "Eine Runde zusätzlich", description: "Das Projekt braucht länger als offeriert. Eine Runde zusätzlich: nochmals würfeln.", actionType: "extraRoll", actionLabel: "Nochmals würfeln", extraRoll: true },
  42: { title: "Kaffeepause", description: "Kaffeepause. Die besten Ideen entstehen sowieso an der Maschine.", actionType: "skip", actionLabel: "Einmal aussetzen", skipTurns: 1 },
  47: { date: "Mai 2019", title: "Eigene Büros", description: "Umzug vom Impact Hub an die Parkterrasse. Erstmals eigene Büros und ein eigener Schlüssel.", actionType: "move", actionLabel: "Vor auf Feld 67", targetField: 67, movement: "forward" },
  49: { date: "März 2020", title: "Die Pandemie", description: "Sämtliche Schulungen abgesagt, Mandate laufen aus, die Stuhlreihen bleiben leer.", actionType: "move", actionLabel: "Zurück auf Feld 18", targetField: 18, movement: "backward", connectionVisual: "snake", connectionAsset: "/assets/snake-49-18.png" },
  51: { date: "Mai 2021", title: "kesabi entsteht", description: "Die Idee zu kesabi entsteht. Aus einem Problem im Alltag wird ein eigenes Produkt.", actionType: "move", actionLabel: "Vor auf Feld 69", targetField: 69, movement: "forward" },
  58: { date: "Januar 2022", title: "Eine Tür bleibt offen", description: "Die erste Kündigung. Eine Tür steht offen, ein Haken bleibt leer.", actionType: "move", actionLabel: "Zurück auf Feld 44", targetField: 44, movement: "backward", connectionVisual: "snake", connectionAsset: "/assets/snake-58-44.png" },
  60: { date: "September 2023", title: "Einundzwanzig", description: "Erstmals mehr als zwanzig Mitarbeitende – genau 21.", actionType: "move", actionLabel: "Vor auf Feld 81", targetField: 81, movement: "forward" },
  65: { title: "Speed Coaching", description: "Wer vorn ist, kommt zurück und gibt das Wissen weiter. Kostet Vorsprung, bringt das Team voran.", actionType: "leaderBack", actionLabel: "Führende Figur auf Feld 65", specialRule: "Alle gemeinsam führenden Figuren oberhalb von Feld 65 werden zurückgesetzt." },
  71: { date: "13. bis 16. Juni 2024", title: "Piemont", description: "Vier Tage gemeinsam im Piemont. Hügel, Essen, Wein und keine Traktanden.", actionType: "skip", actionLabel: "Einmal aussetzen", skipTurns: 1 },
  77: { date: "November 2024", title: "Abschied von kesabi", description: "kesabi wird abgeschaltet. Gute Idee, falscher Moment.", actionType: "move", actionLabel: "Zurück auf Feld 46", targetField: 46, movement: "backward", connectionVisual: "snake", connectionAsset: "/assets/snake-77-46.png" },
  84: { date: "Mai 2025", title: "Der Tisch ist voll", description: "Höchststand mit 24 Mitarbeitenden. Der Tisch ist bis auf den letzten Platz besetzt.", actionType: "move", actionLabel: "Vor auf Feld 97", targetField: 97, movement: "forward", connectionVisual: "graphic" },
  87: { title: "Eingang im Parkhaus", description: "Büro am Bahnhof Bern, Eingang im Parkhaus. Die Kundschaft sucht noch.", actionType: "move", actionLabel: "Zurück auf Feld 86", targetField: 86, movement: "backward", connectionVisual: "graphic" },
  89: { title: "KI verändert das Geschäft", description: "KI verändert das Geschäft: erst lernen, dann doppelt so schnell.", actionType: "doubleNext", actionLabel: "Einmal aussetzen, danach doppelt", skipTurns: 1, nextRollMultiplier: 2 },
  93: { title: "Angebot schärfen", description: "Der Markt verändert sich – avega nutzt die Zeit, um das Angebot zu schärfen.", actionType: "move", actionLabel: "Zurück auf Feld 79", targetField: 79, movement: "backward", connectionVisual: "snake", connectionAsset: "/assets/snake-93-79.png" },
  99: { title: "Perspektivwechsel", description: "Zusammen an einer Aufgabe: Einmal kurz die Perspektive wechseln, und beide sehen mehr.", actionType: "swapNearest", actionLabel: "Platz mit nächster Figur tauschen", swapPosition: true, specialRule: "Bei gleicher Distanz wird zuerst die Figur vor der aktiven Figur, danach die frühere Spielreihenfolge gewählt." },
  100: { title: "Zehn Jahre avega", description: "Zehn Jahre avega. Jetzt wird angestossen.", actionType: "goal", actionLabel: "Ziel", popupImportance: "high" },
};

export const fields: FieldConfig[] = Array.from({ length: 100 }, (_, index) => {
  const fieldNumber = index + 1;
  const event = events[fieldNumber];
  return {
    fieldNumber,
    fieldType: fieldNumber === 100 ? "goal" : event ? "event" : "normal",
    popupEnabled: Boolean(event && fieldNumber !== 1),
    illustration: event ? `/events/field-${fieldNumber}.webp` : undefined,
    animationType: event?.actionType === "move" ? (event.movement === "forward" ? "ladder" : "slide") : event?.actionType === "swapNearest" ? "swap" : event?.actionType === "goal" ? "celebrate" : "step",
    ...event,
  } as FieldConfig;
});

export const fieldByNumber = Object.fromEntries(fields.map((field) => [field.fieldNumber, field])) as Record<number, FieldConfig>;

export const movementConnections = fields
  .filter((field) => field.actionType === "move" && field.targetField)
  .map((field) => ({
    from: field.fieldNumber,
    to: field.targetField!,
    type: field.connectionVisual ?? (field.movement === "forward" ? "ladder" : "snake"),
    asset: field.connectionAsset,
  }));

export function fieldGridPosition(fieldNumber: number) {
  const zero = fieldNumber - 1;
  const gameRow = Math.floor(zero / 10);
  const offset = zero % 10;
  const column = gameRow % 2 === 0 ? offset : 9 - offset;
  return { column, rowFromTop: 9 - gameRow };
}

export function exactFinishPath(from: number, distance: number) {
  const path: number[] = [];
  let position = from;
  let direction = 1;
  for (let step = 0; step < distance; step++) {
    if (position === 100) direction = -1;
    position += direction;
    path.push(position);
  }
  return path;
}

export const playerColors = ["#0069B4", "#e94f37", "#f5a623", "#4a9d72", "#7757a8", "#ef7eb3", "#2f4858", "#57b8c7"];
