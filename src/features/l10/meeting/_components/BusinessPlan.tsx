"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/BusinessPlan.tsx); keep in step with it. See src/features/l10/README.md.

import { StatusBadge } from "@/features/l10/ui/StatusBadge";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { rockState } from "@/features/l10/lib/dueStatus";
import { newItemId } from "@/features/l10/lib/doc";
import type { BrandCard, MeetingDoc, Rock, Vto, VtoItem } from "@/features/l10/lib/types";

function Block({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[10px] border border-line bg-white p-5 shadow-card">
      <h3 className="m-0 text-base font-bold">{title}</h3>
      {subtitle && <p className="m-0 mt-0.5 mb-3 text-xs text-muted">{subtitle}</p>}
      {children}
    </section>
  );
}

function TextField({ label, value, onChange, multiline }: { label: string; value: string | undefined; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-bold tracking-wide text-muted uppercase">
      {label}
      {multiline ? (
        <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, "min-h-20 py-2 text-sm font-normal tracking-normal text-ink normal-case")} />
      ) : (
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, "text-sm font-normal tracking-normal text-ink normal-case")} />
      )}
    </label>
  );
}

function ItemList({ label, items, placeholder, onChange }: { label: string; items: VtoItem[]; placeholder: string; onChange: (next: VtoItem[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-2">
          <input aria-label={`${label} item`} value={it.text} placeholder={placeholder} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))} className={cx(inputClass, "text-sm")} />
          <button type="button" aria-label={`Remove ${label} item ${it.text}`} className="px-2 text-xs text-muted hover:text-[#8a1c1c]" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
            ✕
          </button>
        </div>
      ))}
      <Button variant="outline" className="self-start" onClick={() => onChange([...items, { id: newItemId(), text: "" }])}>
        Add {label} item
      </Button>
    </div>
  );
}

/** This meeting's Vision / Traction Organizer. Edits go through the same version-checked save and merge as everything else. */
export function BusinessPlan({ meetingName, doc, edit, today }: { meetingName: string; doc: MeetingDoc; edit: (fn: (d: MeetingDoc) => MeetingDoc) => void; today?: string }) {
  const vto = doc.vto;
  const patch = (p: Partial<Vto>) => edit((d) => ({ ...d, vto: { ...d.vto, ...p } }));
  const values = vto.coreValues ?? [];
  const setValues = (coreValues: NonNullable<Vto["coreValues"]>) => patch({ coreValues });
  const companyRocks: Rock[] = doc.rocks.filter((r) => r.owner === "Company");

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-muted">Reference for the {meetingName}. Edits save and sync to everyone automatically.</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Block title="Core Values" subtitle="Who we are: hire, fire, review, reward by these.">
          <div className="flex flex-col gap-3">
            {values.map((cv) => (
              <div key={cv.id} className="rounded-lg bg-cream p-3">
                <div className="flex items-center gap-2">
                  <input aria-label="Core value" value={cv.name} placeholder="Value" onChange={(e) => setValues(values.map((x) => (x.id === cv.id ? { ...x, name: e.target.value } : x)))} className={cx(inputClass, "text-sm font-semibold")} />
                  <button type="button" aria-label={`Remove core value ${cv.name}`} className="px-2 text-xs text-muted hover:text-[#8a1c1c]" onClick={() => setValues(values.filter((x) => x.id !== cv.id))}>
                    ✕
                  </button>
                </div>
                <textarea aria-label={`What ${cv.name || "this value"} means in practice`} value={cv.desc} rows={2} placeholder="What it means in practice" onChange={(e) => setValues(values.map((x) => (x.id === cv.id ? { ...x, desc: e.target.value } : x)))} className={cx(inputClass, "mt-2 py-2 text-xs")} />
              </div>
            ))}
            <Button variant="outline" className="self-start" onClick={() => setValues([...values, { id: newItemId(), name: "", desc: "" }])}>
              Add value
            </Button>
          </div>
        </Block>

        <Block title="Core Focus" subtitle="Vision, mission, niche, and the long-term target.">
          <div className="flex flex-col gap-3">
            <TextField label="Vision" value={vto.vision} onChange={(v) => patch({ vision: v })} multiline />
            <TextField label="Mission (purpose)" value={vto.purpose} onChange={(v) => patch({ purpose: v })} multiline />
            <TextField label="Niche" value={vto.niche} onChange={(v) => patch({ niche: v })} multiline />
            <TextField label="10-Year Target" value={vto.tenYear} onChange={(v) => patch({ tenYear: v })} />
            <TextField label="Marketing Strategy" value={vto.marketingStrategy} onChange={(v) => patch({ marketingStrategy: v })} multiline />
            <TextField label="Plan revised" value={vto.revised} onChange={(v) => patch({ revised: v })} />
          </div>
        </Block>

        <Block title="3-Year Picture" subtitle="What the business looks like three years out.">
          <ItemList label="3-year" items={vto.threeYear ?? []} placeholder="e.g. $75M annual revenue" onChange={(threeYear) => patch({ threeYear })} />
        </Block>

        <Block title="1-Year Plan" subtitle="Goals for this year.">
          <ItemList label="1-year" items={vto.oneYear ?? []} placeholder="e.g. Grow revenue 20% YoY" onChange={(oneYear) => patch({ oneYear })} />
        </Block>
      </div>

      <Brands brands={vto.brands ?? []} onChange={(brands) => patch({ brands })} />

      <Block title="Quarterly Rocks: Company">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {companyRocks.length === 0 && <li className="text-sm text-muted">No company rocks yet. Add them from the Rock Review tab.</li>}
          {companyRocks.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-sm">
              <span className="font-semibold">{r.title}</span>
              {today && r.status === "done" && <StatusBadge state="done" />}
              {today && (rockState(r, today) === "overdue" || rockState(r, today) === "soon") && <StatusBadge state={rockState(r, today) as "overdue" | "soon"} />}
              <span className="ml-auto text-xs text-muted">
                {r.milestones.filter((m) => m.done).length}/{r.milestones.length} milestones · {r.status}
              </span>
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}

const emptyBrand = (): BrandCard => ({ id: newItemId(), brand: "", target: "", differentiators: ["", "", "", ""], process: "", guarantee: "" });

/** Marketing by brand: who we're for, why us (four differentiators), the proven process and the guarantee. */
function Brands({ brands, onChange }: { brands: BrandCard[]; onChange: (next: BrandCard[]) => void }) {
  const set = (id: string, p: Partial<BrandCard>) => onChange(brands.map((b) => (b.id === id ? { ...b, ...p } : b)));
  return (
    <Block title="Marketing by Brand" subtitle="One card per brand: who it is for, why us, the proven process and the guarantee.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {brands.map((b) => {
          const name = b.brand || "this brand";
          const diffs = [...b.differentiators, "", "", "", ""].slice(0, Math.max(4, b.differentiators.length));
          return (
            <section key={b.id} aria-label={`Brand ${name}`} className="flex flex-col gap-2.5 rounded-[10px] bg-cream/60 p-4" data-testid="brand-card">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <TextField label="Brand" value={b.brand} onChange={(v) => set(b.id, { brand: v })} />
                </div>
                <button type="button" aria-label={`Remove brand ${name}`} className="min-h-11 px-2 text-xs text-muted hover:text-[#8a1c1c]" onClick={() => onChange(brands.filter((x) => x.id !== b.id))}>
                  ✕
                </button>
              </div>
              <TextField label="Who we're for" value={b.target} onChange={(v) => set(b.id, { target: v })} multiline />
              <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">Why us</legend>
                {diffs.map((d, i) => (
                  <input
                    key={i}
                    aria-label={`Why us ${i + 1} for ${name}`}
                    value={d}
                    onChange={(e) => set(b.id, { differentiators: diffs.map((x, j) => (j === i ? e.target.value : x)) })}
                    className={cx(inputClass, "text-sm")}
                  />
                ))}
              </fieldset>
              <TextField label="Proven process" value={b.process} onChange={(v) => set(b.id, { process: v })} multiline />
              <TextField label="Our guarantee" value={b.guarantee} onChange={(v) => set(b.id, { guarantee: v })} multiline />
            </section>
          );
        })}
      </div>
      <Button variant="outline" className="mt-3 self-start" onClick={() => onChange([...brands, emptyBrand()])}>
        Add a brand
      </Button>
    </Block>
  );
}

