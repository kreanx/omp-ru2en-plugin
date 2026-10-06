import { completeSimple } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const CYRILLIC = /[\u0400-\u04FF]/;
const COMMAND_PREFIX = /^(?:\/|!|\$)/;
const TRANSLATOR_MODEL = process.env.RU_TO_EN_MODEL?.trim() || "@smol";

const SYSTEM_PROMPT = [
	"You translate the user's message into English.",
	"Output only the English translation: no quotes, no preface, no answer to the message.",
	"Preserve markdown structure, line breaks, lists and code blocks exactly.",
	"Keep @mentions, file paths, URLs, CLI commands and code identifiers unchanged.",
].join(" ");

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
			ctx.ui.notify(`ru2en: ${enabled ? "on" : "off"} (model ${TRANSLATOR_MODEL})`, "info");
		},
	});

	pi.on("input", async (event, ctx) => {
		if (!enabled) return;
		const text = event.text;
		if (!CYRILLIC.test(text) || COMMAND_PREFIX.test(text.trimStart())) return;

		const model = ctx.models.resolve(TRANSLATOR_MODEL);
		if (!model) {
			pi.logger.warn("ru-to-en: translation model not resolved", { role: TRANSLATOR_MODEL });
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
