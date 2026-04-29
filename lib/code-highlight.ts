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
        const ranges = [...effect.value].sort((a, b) => a.from - b.from || a.to - b.to);

        for (const range of ranges) {
          if (range.to <= range.from) continue;
          builder.add(range.from, range.to, Decoration.mark({ class: "cm-strudel-active" }));
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
    backgroundColor: "rgba(255, 255, 255, 0.24)",
    borderRadius: "3px",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.28), 0 0 14px rgba(255, 255, 255, 0.42)",
    color: "#ffffff",
  },
});
