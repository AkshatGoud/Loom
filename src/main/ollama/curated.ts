/**
 * Hand-picked recommended model catalog, shown in the Model Library UI as
 * the default "browse" experience. This is the curated face of Ollama's
 * registry — Ollama has no public registry search API, so we maintain this
 * list in code. Users can still pull any arbitrary tag via the "Pull custom:
 * <tag>" fallback in the library search box.
 *
 * Keep entries ordered roughly from most-recommended to least inside each
 * category. Size / RAM estimates are conservative upper bounds for the
 * default quantization Ollama ships for each tag — actual RAM use depends
 * on context length and concurrent models.
 */

export type ModelCategory =
  | 'multimodal'
  | 'text'
  | 'coding'
  | 'reasoning'
  | 'vision';

export interface CuratedModel {
  /** Ollama tag used by `/api/pull` and `/api/chat`. */
  id: string;
  /** Short user-facing label. */
  displayName: string;
  /** One- to two-sentence description rendered on the catalog card. */
  description: string;
  category: ModelCategory;
  /** Best-effort download size in bytes, used only for display. */
  approxSizeBytes: number;
  /** Minimum free RAM we recommend before pulling. */
  minRamBytes: number;
  family: string;
  parameterSize: string;
  supportsTools: boolean;
  supportsVision: boolean;
  /** Free-text tags used by the search filter. */
  tags: string[];
}

const GB = 1_024 ** 3;

export const CURATED_MODELS: CuratedModel[] = [
  // --- Multimodal (Gemma 4) ---
  {
    id: 'gemma4:e4b',
    displayName: 'Gemma 4 E4B',
    description:
      "Google's newest multimodal open model at a laptop-friendly size. 4-bit quantized, 256K context, text + image input. The recommended default for most Macs.",
    category: 'multimodal',
    approxSizeBytes: 3 * GB,
    minRamBytes: 8 * GB,
    family: 'gemma4',
    parameterSize: '4.3B (effective)',
    supportsTools: true,
    supportsVision: true,
    tags: ['gemma', 'google', 'default', 'multimodal', 'vision', 'recommended']
  },
  {
    id: 'gemma4:e2b',
    displayName: 'Gemma 4 E2B',
    description:
      "Gemma 4's smallest variant. Fast and memory-efficient — ideal for older laptops or when you need headroom for heavy development work. 256K context.",
    category: 'multimodal',
    approxSizeBytes: 1.5 * GB,
    minRamBytes: 4 * GB,
    family: 'gemma4',
    parameterSize: '2.1B (effective)',
    supportsTools: true,
    supportsVision: false,
    tags: ['gemma', 'google', 'small', 'fast', 'laptop']
  },
  {
    id: 'gemma4:26b-a4b',
    displayName: 'Gemma 4 26B MoE',
    description:
      'Mixture-of-experts architecture: 26B total parameters, only ~4B active per token. Needs 32 GB+ RAM to load but runs at near-4B speed after that.',
    category: 'multimodal',
    approxSizeBytes: 17 * GB,
    minRamBytes: 32 * GB,
    family: 'gemma4',
    parameterSize: '26B (4B active)',
    supportsTools: true,
    supportsVision: true,
    tags: ['gemma', 'google', 'moe', 'high-end']
  },
  {
    id: 'gemma4:31b',
    displayName: 'Gemma 4 31B',
    description:
      "Gemma 4's flagship dense model. Maximum quality but requires a high-end workstation — 48 GB+ RAM recommended.",
    category: 'multimodal',
    approxSizeBytes: 22 * GB,
    minRamBytes: 48 * GB,
    family: 'gemma4',
    parameterSize: '31B',
    supportsTools: true,
    supportsVision: true,
    tags: ['gemma', 'google', 'flagship', 'workstation']
  },

  // --- Text assistants ---
  {
    id: 'llama3.2:3b',
    displayName: 'Llama 3.2 3B',
    description:
      "Meta's compact text model. Fast on any machine, great for lightweight chat and general Q&A.",
    category: 'text',
    approxSizeBytes: 2 * GB,
    minRamBytes: 4 * GB,
    family: 'llama',
    parameterSize: '3B',
    supportsTools: true,
    supportsVision: false,
    tags: ['llama', 'meta', 'small', 'fast', 'text']
  },
  {
    id: 'llama3.3:70b',
    displayName: 'Llama 3.3 70B',
    description:
      "Meta's latest large text model. Excellent reasoning and instruction following — requires 64 GB+ RAM.",
    category: 'text',
    approxSizeBytes: 42 * GB,
    minRamBytes: 64 * GB,
    family: 'llama',
    parameterSize: '70B',
    supportsTools: true,
    supportsVision: false,
    tags: ['llama', 'meta', 'large', 'reasoning', 'workstation']
  },

  // --- Coding ---
  {
    id: 'qwen3:8b',
    displayName: 'Qwen 3 8B',
    description:
      "Alibaba's latest general-purpose model with strong coding and tool-use abilities. Solid middle-ground size.",
    category: 'coding',
    approxSizeBytes: 5 * GB,
    minRamBytes: 12 * GB,
    family: 'qwen',
    parameterSize: '8B',
    supportsTools: true,
    supportsVision: false,
    tags: ['qwen', 'alibaba', 'coding', 'tools']
  },
  {
    id: 'qwen3-coder:latest',
    displayName: 'Qwen 3 Coder',
    description:
      'Coder-specialized variant of Qwen 3. Best-in-class open model for code generation, refactoring, and debugging.',
    category: 'coding',
    approxSizeBytes: 5 * GB,
    minRamBytes: 12 * GB,
    family: 'qwen',
    parameterSize: '8B',
    supportsTools: true,
    supportsVision: false,
    tags: ['qwen', 'coding', 'code', 'programming']
  },

  // --- Reasoning ---
  {
    id: 'deepseek-r1:7b',
    displayName: 'DeepSeek R1 7B',
    description:
      'Open reasoning model with visible chain-of-thought. Excels at math, logic, and step-by-step problem solving.',
    category: 'reasoning',
    approxSizeBytes: 4.5 * GB,
    minRamBytes: 10 * GB,
    family: 'deepseek',
    parameterSize: '7B',
    supportsTools: false,
    supportsVision: false,
    tags: ['deepseek', 'reasoning', 'math', 'logic', 'cot']
  },

  // --- Vision ---
  {
    id: 'qwen3-vl:8b',
    displayName: 'Qwen 3 VL',
    description:
      'Vision-language variant of Qwen 3. Handles image understanding, chart reading, and screenshot-based tasks.',
    category: 'vision',
    approxSizeBytes: 5.5 * GB,
    minRamBytes: 12 * GB,
    family: 'qwen',
    parameterSize: '8B',
    supportsTools: false,
    supportsVision: true,
    tags: ['qwen', 'vision', 'image', 'multimodal']
  }
];

export const CATEGORY_LABELS: Record<ModelCategory, string> = {
  multimodal: 'Multimodal assistants',
  text: 'Text assistants',
  coding: 'Coding',
  reasoning: 'Reasoning',
  vision: 'Vision'
};
