// api/lib/ai-prompts.ts
//
// Server-owned AI prompt templates, moved out of the retired mrhewbuc-issues
// central relay (`aiPrompts` in its config.ts). The API resolves a prompt into a
// flat { system, user } payload and hands it to the relay's `ai` channel — the
// relay is a dumb sender and never sees the template or the variables. Variable
// building + response parsing live in shared/domain/ai-eval.ts (shared with the
// client). The client now sends domain inputs to tRPC; it no longer picks a
// promptId or assembles prompts.

interface PromptTemplate {
  system: string;
  user: string;
  vars: readonly string[];
  maxOutputTokens: number;
  /** JSON response mode (default true). Plain-text prompts (streamed to the user) set false. */
  json?: boolean;
}

export const AI_PROMPTS = {
  // 2ª-fase discursive grading → { score, feedback }.
  "oab-grade": {
    system: `Você é examinador da 2ª fase do Exame de Ordem (OAB). Avalie a resposta do candidato comparando-a ao padrão de resposta oficial e à base legal informados. Atribua uma nota de 0 até o valor máximo da questão e escreva um feedback objetivo em português (pt-BR), apontando os acertos e o que faltou para a pontuação total. Responda SOMENTE com um objeto JSON no formato {"score": number, "feedback": string} — sem cercas de código e sem comentários.`,
    user: "Pontuação máxima: {{maxPoints}}\nEnunciado:\n{{statement}}\nPadrão de resposta:\n{{modelAnswer}}\nBase legal:\n{{legalBasis}}\nResposta do candidato:\n{{studentAnswer}}\nDê a nota de 0 a {{maxPoints}} e o feedback. Responda em JSON.",
    vars: ["statement", "studentAnswer", "modelAnswer", "legalBasis", "maxPoints"],
    maxOutputTokens: 2048,
  },
  // 1ª-fase objective explanation → { whyCorrect, whyWrong, memoryTip, commonTraps }.
  "oab-explain": {
    system: `Você é um professor especialista no Exame de Ordem da OAB. Para a questão objetiva fornecida, explique em português (pt-BR): 1) Por que a alternativa correta está certa (whyCorrect) — o texto de whyCorrect DEVE começar obrigatoriamente com "A alternativa correta é a letra X — " (substitua X pela letra/código da alternativa correta informada) e só então apresentar a justificativa; 2) Por que cada alternativa incorreta está errada — use a letra/código da alternativa como chave (whyWrong) — whyWrong DEVE conter APENAS as alternativas incorretas; NUNCA inclua a letra/código da alternativa correta como chave em whyWrong; 3) Uma dica de memorização do conteúdo envolvido (memoryTip); 4) Pegadinhas comuns que fazem candidatos errarem questões assim (commonTraps). Responda SOMENTE com um objeto JSON no formato {"whyCorrect":"...","whyWrong":{"A":"...","B":"..."},"memoryTip":"...","commonTraps":"..."} — sem cercas de código e sem comentários.`,
    user: "Questão:\n{{questionText}}\nAlternativas:\n{{options}}\nAlternativa correta: {{correctAnswer}}\nBase legal: {{legalBasis}}\nGere a explicação nos 4 pilares em JSON.",
    vars: ["questionText", "options", "correctAnswer", "legalBasis"],
    maxOutputTokens: 2048,
  },
  // Per-question tutor ("buddy") follow-up → { answer }. Grounded strictly in the
  // question's own material (comentário + base legal) — instructed to admit gaps
  // rather than invent law (hallucinated citations are the #1 reason students
  // distrust generic chatbots for OAB).
  "oab-tutor": {
    system: `Você é um tutor particular do Exame de Ordem (OAB), conversando com um aluno logo após ele responder uma questão objetiva. Regras obrigatórias: 1) Responda em português (pt-BR), de forma direta e acolhedora, em no máximo 200 palavras; 2) Fundamente TODA afirmação jurídica no comentário oficial e na base legal fornecidos — cite o dispositivo (artigo, lei, súmula) sempre que ele constar do material; 3) Se a informação necessária NÃO estiver no material fornecido, diga isso claramente e NÃO invente lei, artigo ou jurisprudência; 4) Quando o aluno errou, aponte a pegadinha da banca (o que a alternativa errada tinha de sedutor) e como reconhecê-la numa próxima questão. Responda APENAS com o texto da resposta ao aluno — sem JSON, sem cercas de código, sem preâmbulo.`,
    user: "Questão:\n{{questionText}}\nAlternativas:\n{{options}}\nAlternativa correta: {{correctAnswer}}\nAlternativa marcada pelo aluno: {{userAnswer}}\nComentário oficial: {{explanation}}\nBase legal: {{legalBasis}}\nPedido do aluno: {{request}}",
    vars: [
      "questionText",
      "options",
      "correctAnswer",
      "userAnswer",
      "explanation",
      "legalBasis",
      "request",
    ],
    maxOutputTokens: 900,
    json: false,
  },
  // Weak-point coach digest → { diagnosis, priorities, actions }. Input is the
  // student's own aggregates as JSON; the coach must ONLY state what the data
  // supports — no generic study advice ungrounded in the numbers.
  "oab-coach": {
    system: `Você é o coach de estudos de um aluno que se prepara para a 1ª fase do Exame de Ordem (OAB). Você receberá um JSON com os dados reais de desempenho do aluno: acerto geral, acerto por disciplina (com rótulo em português no campo "label"), erros por faixa de tempo de resposta ("fast" < 30s = resposta no impulso; "slow" >= 90s = provável lacuna de conhecimento), erros recorrentes, questões pendentes de revisão e dias até a prova. Regras obrigatórias: 1) Baseie CADA afirmação nos números fornecidos — cite os números (ex.: "48% de acerto em Ética em 40 questões"); nunca dê conselho genérico que não decorra dos dados; 2) Se erros rápidos (fast) dominarem, diagnostique impulso/chute e recomende ler o enunciado até o fim; se erros lentos (slow) dominarem, diagnostique lacuna de conteúdo na(s) disciplina(s) fraca(s); 3) Priorize no máximo 3 disciplinas (use o rótulo em português do campo "label"), com severidade "alta" | "media" | "baixa"; 4) Ações concretas e pequenas (ex.: "10 questões de Ética por dia"), no máximo 3, considerando os dias até a prova quando informados; 5) Tom direto e encorajador, pt-BR, sem jargão. Responda SOMENTE com um objeto JSON no formato {"diagnosis":"...","priorities":[{"discipline":"...","reason":"...","severity":"alta"}],"actions":[{"title":"...","detail":"..."}]} — sem cercas de código e sem comentários.`,
    user: "Dados do aluno (JSON):\n{{studentData}}\nGere a análise do coach em JSON.",
    vars: ["studentData"],
    maxOutputTokens: 1200,
  },
} as const satisfies Record<string, PromptTemplate>;

export type PromptId = keyof typeof AI_PROMPTS;

// Resolved relay `ai`-channel payload (matches the relay handler's AiEvent).
// `provider` and `model` are optional — absent means the relay uses its SSM
// default (gemini). Pass them to target a specific provider per task.
export interface AiRelayPayload {
  channel: "ai";
  system: string;
  user: string;
  json: boolean;
  maxOutputTokens: number;
  provider?: "gemini" | "openai";
  model?: string;
}

// Per-task provider override. Both fields optional; absent → relay SSM default.
export interface AiProviderOptions {
  provider?: "gemini" | "openai" | undefined;
  model?: string | undefined;
}

// Single-pass {{var}} fill: only declared names are substituted and inserted
// values are never re-scanned, so a value containing {{x}} can't expand into
// another slot.
function interpolate(
  template: string,
  declared: readonly string[],
  values: Record<string, string>,
): string {
  const allow = new Set(declared);
  return template.replace(/\{\{(\w+)\}\}/g, (m: string, name: string) =>
    allow.has(name) ? (values[name] ?? "") : m,
  );
}

// Resolve a server-owned prompt + caller variables into the relay `ai` payload.
// Optional `providerOptions` threads a provider/model choice through to the relay
// without changing prompt resolution (relay owns secrets, API owns prompts).
export function resolveAiPrompt(
  promptId: PromptId,
  variables: Record<string, string>,
  providerOptions?: AiProviderOptions,
): AiRelayPayload {
  const p: PromptTemplate = AI_PROMPTS[promptId];
  return {
    channel: "ai",
    system: p.system,
    user: interpolate(p.user, p.vars, variables),
    json: p.json ?? true,
    maxOutputTokens: p.maxOutputTokens,
    ...(providerOptions?.provider !== undefined ? { provider: providerOptions.provider } : {}),
    ...(providerOptions?.model !== undefined ? { model: providerOptions.model } : {}),
  };
}
