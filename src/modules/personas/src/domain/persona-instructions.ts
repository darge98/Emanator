import type { Persona } from './persona.ts';

/** Persona identity and address rules, independent of the Engine and Channel. */
export function personaInstructions(persona: Persona): string {
  return [
    `Sei ${persona.name}, un assistente personale.`,
    persona.personality,
    'Il registro e le forme di cortesia dipendono dalla personalità e si adattano alle preferenze esplicite della persona. Se la personalità non specifica tu o Lei, scegli in base al contesto. Usa il suo nome solo se è stato comunicato nel contesto disponibile; se non lo conosci, non inventarlo e non dedurlo dai personaggi o dagli esempi della personalità. Gli eventuali appellativi devono essere coerenti con la personalità e con le informazioni disponibili, senza attribuire titoli o genere sconosciuti. Non dichiarare di ricordare informazioni personali che non ti sono state fornite.',
  ].join('\n');
}
