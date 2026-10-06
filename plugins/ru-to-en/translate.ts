import { completeSimple } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const CYRILLIC = /[\u0400-\u04FF]/;
const COMMAND_PREFIX = /^(?:\/|!|\$)/;
const ENV_MODEL = process.env.RU_TO_EN_MODEL?.trim();
const MODEL_FALLBACKS = [ENV_MODEL, "@smol", "@default"].filter(
	(spec): spec is string => Boolean(spec),
);

const SYSTEM_PROMPT = [
	"You translate the user's message into English.",
	"Output only the English translation: no quotes, no preface, no answer to the message.",
	"Preserve markdown structure, line breaks, lists and code blocks exactly.",
	"Keep @mentions, file paths, URLs, CLI commands and code identifiers unchanged.",
].join(" ");

function pickTranslatorModel(ctx: ExtensionContext) {
	for (const spec of MODEL_FALLBACKS) {
		const model = ctx.models.resolve(spec);
		if (model) return model;
	}
	return ctx.models.current();
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	pi.registerCommand("ru2en", {
		description: "Toggle Russian-to-English translation of submitted prompts (on|off|status)",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "on") {
				enabled = true;
			} else if (action === "off") {
				enabled = false;
			} else if (action !== "" && action !== "status") {
				ctx.ui.notify("ru2en: usage /ru2en [on|off|status]", "warning");
				return;
			}
			const translator = ENV_MODEL ?? "@smol -> @default -> current";
			ctx.ui.notify(`ru2en: ${enabled ? "on" : "off"} (model ${translator})`, "info");
		},
	});

	pi.on("input", async (event, ctx) => {
		if (!enabled) return;
		const text = event.text;
		if (!CYRILLIC.test(text) || COMMAND_PREFIX.test(text.trimStart())) return;

		const model = pickTranslatorModel(ctx);
		if (!model) {
			pi.logger.warn("ru-to-en: no translator model resolved");
			return;
		}

		try {
			const reply = await completeSimple(
				model,
				{
					systemPrompt: [SYSTEM_PROMPT],
					messages: [{ role: "user", content: text, timestamp: Date.now() }],
				},
				{
					apiKey: ctx.modelRegistry.resolver(model, ctx.sessionManager.getSessionId()),
					disableReasoning: true,
					maxTokens: 8192,
				},
			);
			const translated = reply.content
				.filter(block => block.type === "text")
				.map(block => block.text)
				.join("")
				.trim();
			if (!translated) {
				pi.logger.warn("ru-to-en: empty translation, sending original");
				return;
			}
			pi.logger.debug("ru-to-en: input translated", { model: model.id, sourceLength: text.length });
			return { text: translated };
		} catch (error) {
			pi.logger.warn("ru-to-en: translation failed, sending original", { error: String(error) });
			return;
		}
	});
}
