import { cleanText } from "./handoffBundle.mjs";
import { loadImpeccableSkill } from "./skillRegistry.mjs";
import { normalizeBrief, normalizeReferences } from "./designWorkspace.mjs";

const interviewFields = [
  { key: "product", label: "What are you making?", hint: "A landing page, dashboard, app, portfolio, shop, or something else." },
  { key: "audience", label: "Who is it for?", hint: "Name the people who will use it and what they need." },
  { key: "feeling", label: "What should it feel like?", hint: "Calm, premium, playful, editorial, technical, warm, direct." },
  { key: "avoid", label: "What should it avoid?", hint: "Styles, websites, copy, or behavior you do not want." },
  { key: "references", label: "Any style references?", hint: "Paste links, mention screenshots, or describe what you like." },
];

export async function nextInterviewQuestion(payload = {}, env = process.env) {
  const impeccable = await loadImpeccableSkill(env);
  const brief = mergeAnswerIntoBrief(payload);
  const references = normalizeReferences(payload.references || []);
  const history = Array.isArray(payload.history) ? payload.history.map(cleanHistoryItem).filter(Boolean).slice(-12) : [];
  const missing = interviewFields.filter((field) => !brief[field.key]);

  const providerQuestion = await askOpenAIForQuestion({
    brief,
    references,
    history,
    missing,
    teachReference: impeccable.teach,
    env,
  }).catch(() => null);

  if (providerQuestion) {
    return {
      ...providerQuestion,
      brief,
      references,
      history,
      source: "impeccable-openai",
      skill: {
        name: "Impeccable",
        root: impeccable.root,
        reference: "reference/teach.md",
      },
    };
  }

  const fallback = fallbackQuestion(brief, missing);
  return {
    ...fallback,
    brief,
    references,
    history,
    source: "impeccable-local",
    skill: {
      name: "Impeccable",
      root: impeccable.root,
      reference: "reference/teach.md",
    },
  };
}

function mergeAnswerIntoBrief(payload) {
  const brief = normalizeBrief(payload.brief || {});
  const lastQuestionKey = cleanText(payload.lastQuestionKey, 60);
  const answer = cleanText(payload.answer, 800);

  if (lastQuestionKey && answer && Object.hasOwn(brief, lastQuestionKey)) {
    brief[lastQuestionKey] = answer;
    brief.rawAnswers = [...brief.rawAnswers, answer].slice(-12);
  }

  const initial = cleanText(payload.initialPrompt || payload.prompt || payload.command, 500);
  if (initial && !brief.product) {
    brief.product = initial;
    brief.rawAnswers = [...brief.rawAnswers, initial].slice(-12);
  }

  return brief;
}

async function askOpenAIForQuestion({ brief, references, history, missing, teachReference, env }) {
  const key = env.OPENAI_API_KEY || env.CODEX_API_KEY || "";
  if (!key) return null;

  const body = {
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You are Palette's design interviewer for non-coders.",
              "Use the real Impeccable teach flow below to decide the next useful question.",
              "Ask one short plain-English question at a time.",
              "Never mention Impeccable, slash commands, PRODUCT.md, DESIGN.md, files, or terminals to the user.",
              "When enough context exists to create PRODUCT.md and DESIGN.md, set complete true.",
              "Return JSON only.",
              "",
              teachReference.slice(0, 14000),
            ].join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              brief,
              references,
              history,
              missingFields: missing.map((field) => field.key),
              requiredOutput: {
                complete: "boolean",
                question: "string",
                field: "product|audience|feeling|avoid|references|done",
                helper: "string",
                status: "string",
              },
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "palette_interview_question",
        strict: false,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["complete", "question", "field", "helper", "status"],
          properties: {
            complete: { type: "boolean" },
            question: { type: "string" },
            field: { type: "string" },
            helper: { type: "string" },
            status: { type: "string" },
          },
        },
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message || `OpenAI request failed with ${response.status}`);
  const text = extractOutputText(json);
  if (!text) return null;
  const parsed = JSON.parse(text);

  return sanitizeQuestion(parsed, missing);
}

function fallbackQuestion(brief, missing) {
  if (missing.length === 0) {
    return {
      complete: true,
      field: "done",
      question: "Your canvas is ready for references.",
      helper: "Add screenshots, links, or notes before Palette starts painting.",
      status: "The design brief is ready.",
    };
  }

  const next = missing[0];
  return {
    complete: false,
    field: next.key,
    question: next.label,
    helper: next.hint,
    status: brief.product ? "One more detail will sharpen the canvas." : "Tell Palette what to paint first.",
  };
}

function sanitizeQuestion(question, missing) {
  const allowed = new Set([...interviewFields.map((field) => field.key), "done"]);
  const missingKeys = new Set(missing.map((field) => field.key));
  let field = cleanText(question?.field, 40);
  if (!allowed.has(field)) field = missing[0]?.key || "done";
  if (field !== "done" && missingKeys.size > 0 && !missingKeys.has(field)) field = missing[0]?.key || field;

  const complete = Boolean(question?.complete) || field === "done" || missing.length === 0;
  const fieldMeta = interviewFields.find((item) => item.key === field);

  return {
    complete,
    field: complete ? "done" : field,
    question: cleanText(question?.question, 180) || fieldMeta?.label || "Your canvas is ready for references.",
    helper: cleanText(question?.helper, 240) || fieldMeta?.hint || "Add screenshots, links, or notes before Palette starts painting.",
    status: cleanText(question?.status, 180) || (complete ? "The design brief is ready." : "Palette is shaping the brief."),
  };
}

function cleanHistoryItem(item) {
  if (!item || typeof item !== "object") return null;
  const question = cleanText(item.question, 240);
  const answer = cleanText(item.answer, 800);
  const field = cleanText(item.field, 80);
  return question || answer ? { question, answer, field } : null;
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const chunks = [];
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}
