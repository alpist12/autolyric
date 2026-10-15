const notes = [
  ["G", 1, 4], ["C", 1, 5], ["E", 0, 5], ["G", 1, 4],
  ["B", 0, 4], ["E", 0, 5], ["G", 1, 5], ["B", 0, 4],
  ["C", 1, 5], ["E", 0, 5], ["A", 0, 5], ["C", 1, 5],
  ["G", 1, 4], ["D", 1, 5], ["F", 1, 5], ["G", 1, 4],
  ["A", 0, 4], ["C", 1, 5], ["E", 0, 5], ["A", 0, 4],
  ["G", 1, 4], ["B", 0, 4], ["E", 0, 5], ["G", 1, 4],
  ["F", 1, 4], ["A", 0, 4], ["D", 1, 5], ["F", 1, 4],
  ["E", 0, 4], ["G", 1, 4], ["C", 1, 5], ["E", 0, 4],
] as const;

const measures = Array.from({ length: 8 }, (_, measureIndex) => {
  const measureNotes = notes.slice(measureIndex * 4, measureIndex * 4 + 4).map(([step, alter, octave]) =>
    `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>`,
  ).join("");
  const attributes = measureIndex === 0
    ? `<attributes><divisions>2</divisions><key><fifths>4</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="52"/></direction>`
    : measureIndex === 4 ? `<print new-page="yes"/>` : "";
  return `<measure number="${measureIndex + 1}">${attributes}${measureNotes}</measure>`;
}).join("");

export const demoXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>월광 소나타 1악장</work-title></work>
<identification><creator type="composer">L. v. Beethoven</creator></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">${measures}</part></score-partwise>`;
