import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export type CodeRange = {
  from: number;
  to: number;
};

export const setStrudelActiveRanges = StateEffect.define<CodeRange[]>();

export const strudelActiveRangeField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    value = value.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setStrudelActiveRanges)) {
        const builder = new RangeSetBuilder<Decoration>();
        const docLength = transaction.state.doc.length;
        const ranges = [...effect.value]
          .map((range) => ({
            from: Math.max(0, Math.min(docLength, range.from)),
            to: Math.max(0, Math.min(docLength, range.to)),
          }))
          .filter((range) => range.to > range.from)
          .sort((a, b) => a.from - b.from || a.to - b.to);

        if (!ranges.length) {
          value = Decoration.none;
          continue;
        }

        let cursor = 0;
        for (const range of ranges) {
          const from = Math.max(cursor, range.from);
          if (cursor < from) {
            builder.add(cursor, from, Decoration.mark({ class: "cm-strudel-muted" }));
          }
          if (range.to > from) {
            builder.add(from, range.to, Decoration.mark({ class: "cm-strudel-active" }));
          }
          cursor = Math.max(cursor, range.to);
        }

        if (cursor < docLength) {
          builder.add(cursor, docLength, Decoration.mark({ class: "cm-strudel-muted" }));
        }

        value = builder.finish();
      }
    }

    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const strudelActiveRangeTheme = EditorView.baseTheme({
  ".cm-strudel-active": {
    filter: "none",
    textShadow: "none",
  },
  ".cm-strudel-muted": {
    filter: "brightness(0.58) saturate(0.56) contrast(0.92)",
  },
});
