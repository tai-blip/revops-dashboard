// Create the PandaDoc / order-form custom fields on Opportunity in Salesforce.
//
// These back the Deal Desk order-form Flow (PandaDoc delivery + the T&C approval
// branch Andrew reviews). Fields (all on Opportunity):
//   Order_Form_URL__c    Url          — the PandaDoc order-form link
//   TandC_Changed__c     Checkbox     — the rep's "T&C changed" tick; Flow branches on it
//   TandC_Change_Note__c LongTextArea — what changed (Flow makes it required when the tick is Y)
//
// The "PDF attachment" is NOT a field — the generated order form lands as a File
// (ContentDocument) on the Opp at runtime, so there is nothing to create for it here.
//
// Conditional-required ("required when T&C = Y") is enforced by the Flow / a validation
// rule, not a field attribute — a field is either always required or not. These are
// created optional so the Flow owns the rule.
//
// Idempotent: skips any field that already exists. Also grants field-level security
// (read + edit) on the System Administrator profile so the fields are usable immediately.
//
// Usage:
//   node --env-file=.env scripts/create-order-form-fields.mjs            # dry-run (default)
//   node --env-file=.env scripts/create-order-form-fields.mjs --commit   # actually create

const COMMIT = process.argv.includes("--commit");
const V = process.env.SF_API_VERSION || "59.0";

const FIELDS = [
  {
    fullName: "Opportunity.Order_Form_URL__c",
    metadata: {
      label: "Order Form URL",
      type: "Url",
      description: "The PandaDoc order-form link — the Deal Desk Flow uses it for delivery / notifications.",
      inlineHelpText: "Auto-populated with the PandaDoc order-form link.",
      required: false,
    },
  },
  {
    fullName: "Opportunity.TandC_Changed__c",
    metadata: {
      label: "T&C Changed",
      type: "Checkbox",
      defaultValue: false,
      description: "The rep's T&C tick — the Deal Desk Flow's approval branch keys off this.",
      inlineHelpText: "Tick if the terms & conditions were changed from the standard order form.",
    },
  },
  {
    fullName: "Opportunity.TandC_Change_Note__c",
    metadata: {
      label: "T&C Change Note",
      type: "LongTextArea",
      length: 32768,
      visibleLines: 5,
      description: "What changed in the T&C, so Andrew can review. Flow requires it when T&C Changed = true.",
      inlineHelpText: "Required when 'T&C Changed' is ticked — describe exactly what changed.",
      required: false,
    },
  },
];

async function auth() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });
  const r = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("SF auth failed: " + JSON.stringify(j));
  return { token: j.access_token, instance: j.instance_url, idUrl: j.id };
}

async function main() {
  const { token, instance, idUrl } = await auth();
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const q = async (soql) => {
    const r = await fetch(`${instance}/services/data/v${V}/query?q=${encodeURIComponent(soql)}`, { headers: H });
    return r.json();
  };

  const id = await (await fetch(idUrl, { headers: H })).json();
  console.log(`Org:  ${instance}`);
  console.log(`User: ${id.username} (${id.display_name})`);
  console.log(`Mode: ${COMMIT ? "COMMIT — will create fields" : "DRY-RUN — no changes"}\n`);

  // Existing fields (so we skip idempotently)
  const d = await (await fetch(`${instance}/services/data/v${V}/sobjects/Opportunity/describe`, { headers: H })).json();
  const have = new Set((d.fields || []).map((f) => f.name));

  // System Administrator profile's owned permission set (for FLS)
  const ps = await q("SELECT Id FROM PermissionSet WHERE IsOwnedByProfile = true AND Profile.Name = 'System Administrator' LIMIT 1");
  const adminPermSet = ps.records?.[0]?.Id;

  for (const f of FIELDS) {
    const api = f.fullName.split(".")[1];
    if (have.has(api)) { console.log(`• ${api} — already exists, skipping`); continue; }
    const m = f.metadata;
    console.log(`• ${api}  [${m.type}${m.length ? ` len ${m.length}` : ""}]  "${m.label}"`);
    console.log(`    ${m.description}`);
    if (!COMMIT) { console.log("    (dry-run — not created)"); continue; }

    const res = await fetch(`${instance}/services/data/v${V}/tooling/sobjects/CustomField`, {
      method: "POST", headers: H, body: JSON.stringify({ FullName: f.fullName, Metadata: m }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
      console.log(`    ✗ CREATE FAILED (${res.status}): ${JSON.stringify(body)}`);
      continue;
    }
    console.log(`    ✓ created (id ${body.id})`);

    // Grant FLS on the System Administrator profile so it's visible + editable.
    if (adminPermSet) {
      const flsBody = {
        SobjectType: "Opportunity", Field: f.fullName, ParentId: adminPermSet,
        PermissionsRead: true, PermissionsEdit: m.type !== "AutoNumber",
      };
      const fr = await fetch(`${instance}/services/data/v${V}/sobjects/FieldPermissions`, {
        method: "POST", headers: H, body: JSON.stringify(flsBody),
      });
      const fj = await fr.json().catch(() => ({}));
      console.log(fr.ok ? "    ✓ FLS granted (System Administrator: read+edit)"
                        : `    ! FLS not set (${fr.status}): ${JSON.stringify(fj)} — set visibility in Setup if needed`);
    } else {
      console.log("    ! Could not find System Administrator permission set — set FLS in Setup");
    }
  }

  console.log(`\n${COMMIT ? "Done." : "Dry-run complete. Re-run with --commit to create."}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
