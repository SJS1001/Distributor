import { randomBytes } from "node:crypto";
import type { Application } from "../server/application.ts";
import { check, permit, type Actor, type Role } from "../server/core.ts";
import { greeSampleProducts } from "./gree-pilot-seed.ts";
import type { VirtualClock } from "./virtual-clock.ts";

/** Fills the fictional Canadian pilot with several weeks of everyday activity
 * through native commands only, and retires the "SAMPLE" labels through the
 * audited rename commands. Products are generic HVAC accessories or Gree
 * family-level entries; SKUs, prices, costs, stock, serials, customers,
 * contacts and payments are fictional. Emails use the reserved .example
 * domain and telephone numbers use the fictional 555-01xx range.
 * Run only on an offline copy after seedGreePilot; it refuses to run twice.
 */
const DAY = 86400000,
  HOUR = 3600000,
  TORONTO_UTC_OFFSET = 4;

const renamedGree: Record<string, { sku: string; name: string }> = {
  "SAMPLE-GREE-CHARMO": {
    sku: "GRE-CHARMO-R32",
    name: "Gree Charmo R32 single-zone heat pump",
  },
  "SAMPLE-GREE-PULAR": {
    sku: "GRE-PULAR-R32",
    name: "Gree Pular R32 single-zone heat pump",
  },
  "SAMPLE-GREE-AIRY": {
    sku: "GRE-AIRY-R32",
    name: "Gree Airy R32 single-zone heat pump",
  },
  "SAMPLE-GREE-ZENO": {
    sku: "GRE-ZENO-R32",
    name: "Gree ZENO R32 single-zone heat pump",
  },
  "SAMPLE-GREE-MULTI": {
    sku: "GRE-MULTI-R32",
    name: "Gree Multi Zone R32 heat pump",
  },
  "SAMPLE-GREE-FLEXX-ECO": {
    sku: "GRE-FLEXX-ECO-R32",
    name: "Gree FLEXX Eco R32 central heat pump",
  },
  "SAMPLE-GREE-FLEXX-ULTRA": {
    sku: "GRE-FLEXX-ULTRA-R32",
    name: "Gree FLEXX Ultra R32 central heat pump",
  },
  "SAMPLE-GREE-CASSETTE": {
    sku: "GRE-CASSETTE-R32",
    name: "Gree 8-way ceiling cassette indoor unit",
  },
  "SAMPLE-LINESET": {
    sku: "ACC-LINESET-25",
    name: "Insulated line-set kit, 25 ft",
  },
  "SAMPLE-BRACKET": {
    sku: "ACC-WALL-BRACKET",
    name: "Outdoor unit wall bracket",
  },
  "SAMPLE-CONDENSATE": {
    sku: "ACC-CONDENSATE-KIT",
    name: "Condensate drain kit",
  },
};

export const fullPilotProducts = [
  {
    sku: "HVAC-HRV-150",
    name: "Heat recovery ventilator, 150 CFM",
    price: 189900,
    cost: 128000,
    serialized: true,
  },
  {
    sku: "HVAC-FURN-60",
    name: "High-efficiency gas furnace, 60,000 BTU",
    price: 279900,
    cost: 189000,
    serialized: true,
  },
  {
    sku: "HVAC-AHU-24",
    name: "Multi-position air handler, 2 ton",
    price: 169900,
    cost: 112000,
    serialized: true,
  },
  {
    sku: "ACC-INSTALL-KIT",
    name: "Ductless installation kit",
    price: 24900,
    cost: 13500,
  },
  {
    sku: "ACC-PAD-36",
    name: "Composite equipment pad, 36 x 36 in",
    price: 6900,
    cost: 3100,
  },
  {
    sku: "ACC-STAND-GROUND",
    name: "Ground stand for outdoor unit",
    price: 12900,
    cost: 6200,
  },
  {
    sku: "ACC-PUMP-MINI",
    name: "Mini-split condensate pump",
    price: 14900,
    cost: 7400,
  },
  {
    sku: "ACC-DISCONNECT-60",
    name: "Non-fused AC disconnect, 60 A",
    price: 3900,
    cost: 1700,
  },
  {
    sku: "ACC-WHIP-6",
    name: "Liquid-tight electrical whip, 6 ft",
    price: 2900,
    cost: 1200,
  },
  {
    sku: "ACC-LINE-COVER",
    name: "Line-set cover kit, 4 in",
    price: 8900,
    cost: 3900,
  },
  {
    sku: "ACC-WALL-SLEEVE",
    name: "Wall penetration sleeve",
    price: 1900,
    cost: 700,
  },
  { sku: "ACC-FLARE-KIT", name: "Flare fitting kit", price: 3400, cost: 1300 },
  { sku: "ACC-SURGE", name: "HVAC surge protector", price: 7900, cost: 3400 },
  {
    sku: "ACC-FILTER-1625",
    name: "Pleated filter MERV 11, 16 x 25 x 1 in, 12 pack",
    price: 6900,
    cost: 3200,
  },
  {
    sku: "CTL-THERMO-WIFI",
    name: "Wi-Fi programmable thermostat",
    price: 21900,
    cost: 12500,
  },
  {
    sku: "CTL-THERMO-BASIC",
    name: "Non-programmable thermostat",
    price: 5900,
    cost: 2600,
  },
] as const;

const tierDiscounts: Record<string, number> = {
  "sample-contractor": 0.9,
  contractor: 0.9,
  "preferred-contractor": 0.85,
  "volume-contractor": 0.8,
};

const newCustomers = [
  {
    name: "Northshore Climate Systems",
    province: "ON",
    owner: "Jordan Ellis",
    phone: "(705) 555-0141",
    notes:
      "Residential ductless and central installs across Simcoe County. Six installers, two service vans.",
    activated: true,
    tier: "contractor",
    limit: 6000000,
    city: "Barrie",
  },
  {
    name: "Rideau Valley Heating & Cooling",
    province: "ON",
    owner: "Riley Gagnon",
    phone: "(613) 555-0143",
    notes:
      "Heat pump retrofits for the Ottawa Valley; registered with the provincial rebate program.",
    activated: true,
    tier: "preferred-contractor",
    limit: 9000000,
    city: "Ottawa",
  },
  {
    name: "Bluewater Mechanical",
    province: "ON",
    owner: "Charlie Singh",
    phone: "(519) 555-0145",
    notes:
      "Light commercial and residential mechanical contractor in Lambton County.",
    activated: true,
    tier: "contractor",
    limit: 5000000,
    city: "Sarnia",
  },
  {
    name: "Kawartha Home Comfort",
    province: "ON",
    owner: "Hayden Murphy",
    phone: "(705) 555-0147",
    notes:
      "New business; first season installing ductless systems in cottage country.",
    activated: false,
    tier: "contractor",
    limit: 3500000,
    city: "Peterborough",
  },
  {
    name: "Grand River HVAC Services",
    province: "ON",
    owner: "Drew Campbell",
    phone: "(519) 555-0149",
    notes:
      "Multi-crew installer serving Waterloo Region builders and homeowners.",
    activated: true,
    tier: "volume-contractor",
    limit: 15000000,
    city: "Kitchener",
  },
  {
    name: "Niagara Air Solutions",
    province: "ON",
    owner: "Parker Lavoie",
    phone: "(905) 555-0151",
    notes: "Service and replacement work across the Niagara peninsula.",
    activated: true,
    tier: "preferred-contractor",
    limit: 6000000,
    city: "St. Catharines",
  },
  {
    name: "Trillium Building Services",
    province: "ON",
    owner: "Rowan Fraser",
    phone: "(905) 555-0153",
    notes:
      "Property-management maintenance contractor for multi-unit residential buildings.",
    activated: true,
    tier: "volume-contractor",
    limit: 15000000,
    city: "Mississauga",
  },
] as const;

// Applicants still in review or declined; they never become accounts.
const otherApplicants = [
  {
    name: "Muskoka Heat Pump Co.",
    province: "ON",
    owner: "Logan Pierce",
    phone: "(705) 555-0161",
    notes: "Two-person installer moving from oil furnaces to heat pumps.",
    day: -3,
  },
  {
    name: "Prairie Comfort Mechanical",
    province: "MB",
    owner: "Dakota Friesen",
    phone: "(204) 555-0163",
    notes: "Asks whether we deliver to Winnipeg or offer freight terms.",
    day: -1,
  },
  {
    name: "Lakeshore Appliance Repair",
    province: "ON",
    owner: "Jordan Mills",
    phone: "(416) 555-0165",
    notes: "Appliance repair shop looking for parts pricing.",
    day: -20,
    rejected:
      "Appliance repair only; no HVAC installation work or licence on file.",
  },
] as const;

// Nine digits that fail the CRA check digit, so they match no real business.
const fictionalBusinessNumber = (seed: number) => {
  for (let n = 712345678 + seed * 104729; ; n++) {
    const digits = String(n).split("").map(Number);
    const sum = digits.reduce((total, digit, index) => {
      const value = index % 2 ? digit * 2 : digit;
      return total + (value > 9 ? value - 9 : value);
    }, 0);
    if (sum % 10 !== 0) return `${n} RT0001`;
  }
};

const contactNames = [
  ["Jordan Ellis", "Owner"],
  ["Morgan Chen", "Office manager"],
  ["Taylor Brooks", "Service manager"],
  ["Casey Nguyen", "Accounts payable"],
  ["Riley Gagnon", "Owner"],
  ["Jamie Patel", "Purchasing"],
  ["Avery Wilson", "Lead installer"],
  ["Quinn Roy", "Office manager"],
  ["Drew Campbell", "Operations manager"],
  ["Sam Bouchard", "Accounts payable"],
  ["Charlie Singh", "Owner"],
  ["Robin MacLeod", "Estimator"],
  ["Jesse Thompson", "Purchasing manager"],
  ["Kendall Leblanc", "Controller"],
  ["Hayden Murphy", "Owner"],
  ["Blake Côté", "Dispatcher"],
  ["Rowan Fraser", "General manager"],
  ["Emerson Walsh", "Accounts payable"],
  ["Parker Lavoie", "Owner"],
  ["Sydney Kaur", "Office manager"],
] as const;

const staff: {
  key: string;
  name: string;
  email: string;
  role: Role;
  sites: "toronto" | "ottawa" | "both";
}[] = [
  {
    key: "priya",
    name: "Priya Raman",
    email: "priya.raman@staff.dstrbtr.example",
    role: "warehouse",
    sites: "toronto",
  },
  {
    key: "marcus",
    name: "Marcus Lefebvre",
    email: "marcus.lefebvre@staff.dstrbtr.example",
    role: "warehouse",
    sites: "ottawa",
  },
  {
    key: "dana",
    name: "Dana Okafor",
    email: "dana.okafor@staff.dstrbtr.example",
    role: "commercial",
    sites: "both",
  },
  {
    key: "sophie",
    name: "Sophie Tremblay",
    email: "sophie.tremblay@staff.dstrbtr.example",
    role: "finance",
    sites: "both",
  },
  {
    key: "ravi",
    name: "Ravi Chandra",
    email: "ravi.chandra@staff.dstrbtr.example",
    role: "warranty",
    sites: "both",
  },
  {
    key: "alex",
    name: "Alex Morin",
    email: "alex.morin@staff.dstrbtr.example",
    role: "support",
    sites: "both",
  },
];

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function seedFullPilot(
  app: Application,
  admin: Actor,
  options: { clock?: VirtualClock; end?: number } = {},
) {
  admin = app.identity.currentActor(admin);
  permit(admin, []);
  check(
    app.identity.region === "CA" &&
      app.identity.organization(admin).currency === "CAD",
    "SAMPLE_REGION",
    "The full pilot seed requires CA/CAD.",
  );
  const products = () => app.catalog.products(admin);
  const bySku = (sku: string) => {
    const product = products().find((p) => p.sku === sku);
    check(product, "SAMPLE_PRODUCTS", `Expected product ${sku}.`);
    return product;
  };
  check(
    !products().some((p) => p.sku === "ACC-INSTALL-KIT"),
    "SAMPLE_ALREADY_SEEDED",
    "The full pilot seed has already been applied.",
  );
  for (const sample of greeSampleProducts) bySku(sample.sku);

  const end = options.end ?? Date.now(),
    clock = options.clock,
    dayStart = Math.floor(end / DAY) * DAY;
  let tick = 0;
  // Each command key advances the virtual clock slightly so records differ.
  const key = (value: string) => {
    if (clock) clock.set(clock.now() + 90000 + (tick++ % 7) * 13000);
    return `pilot-full-v1-${value}`;
  };
  const at = (day: number, localHour: number) =>
    dayStart + day * DAY + (localHour + TORONTO_UTC_OFFSET) * HOUR;
  const setTime = (ms: number) => clock?.set(Math.min(ms, end - 10 * 60000));
  setTime(at(-65, 8));

  // Warehouses and supplier keep their identities; only labels change.
  const warehouses = app.inventory.warehouses(admin) as {
    id: string;
    name: string;
  }[];
  const find = <T extends { name: string }>(rows: T[], name: string) => {
    const row = rows.find((r) => r.name === name);
    check(row, "SAMPLE_RECORDS", `Expected ${name}.`);
    return row;
  };
  const toronto = find(warehouses, "Toronto HVAC · SAMPLE").id;
  const ottawa = find(warehouses, "Ottawa HVAC · SAMPLE").id;
  const siteIds = {
    toronto: [toronto],
    ottawa: [ottawa],
    both: [toronto, ottawa],
  };

  const people: Record<string, Actor> = {};
  for (const member of staff) {
    const user = app.identity.createUser(admin, key(`user-${member.key}`), {
      email: member.email,
      name: member.name,
      password: randomBytes(24).toString("base64url"),
      role: member.role,
      sites: siteIds[member.sites],
      requirePasswordChange: false,
    });
    people[member.key] = app.identity.currentActor({ ...admin, id: user.id });
  }
  // Trade applications are decided by an administrator who must re-enter a
  // password; this fictional manager's random password exists only here.
  const onboardingPassword = randomBytes(24).toString("base64url");
  const onboarding = app.identity.currentActor({
    ...admin,
    id: app.identity.createUser(admin, key("user-elena"), {
      email: "elena.vasquez@staff.dstrbtr.example",
      name: "Elena Vasquez",
      password: onboardingPassword,
      role: "admin",
      sites: siteIds.both,
      requirePasswordChange: false,
    }).id,
  });
  const applicationId = (email: string) =>
    app.enrollment.queue(onboarding).items.find((a) => a.email === email)!.id;
  const submitApplication = (
    c: {
      name: string;
      province: string;
      owner: string;
      phone: string;
      notes: string;
    },
    index: number,
  ) => {
    const email = `orders@${slug(c.name)}.example`;
    app.enrollment.submit(admin.orgId, {
      businessName: c.name,
      contactName: c.owner,
      email,
      phone: c.phone,
      province: c.province as "ON",
      businessNumber: fictionalBusinessNumber(index),
      notes: c.notes,
      acknowledgment: true,
    });
    return applicationId(email);
  };
  const sales = people.dana!,
    finance = people.sophie!,
    warranty = people.ravi!;
  const warehouseActor = (warehouseId: string) =>
    warehouseId === toronto ? people.priya! : people.marcus!;

  // Trade applications from the contractors who became accounts.
  const approvedAccounts: Record<string, string> = {};
  const pendingInvitations: Record<string, string> = {};
  let applications = 0,
    activatedBuyers = 0;
  newCustomers.forEach((c, index) => {
    setTime(at(-64 + index, 10));
    const applicationRef = submitApplication(c, index);
    applications++;
    setTime(at(-64 + index, 15));
    const decision = app.enrollment.decide(onboarding, applicationRef, {
      decision: "approve",
      currentPassword: onboardingPassword,
      reason: "Trade references and insurance certificate checked",
      tier: c.tier,
      creditLimit: c.limit,
    });
    approvedAccounts[c.name] = app.enrollment
      .queue(onboarding)
      .items.find((a) => a.id === applicationRef)!.accountId!;
    if (c.activated) {
      setTime(at(-64 + index, 17));
      app.enrollment.activate(
        admin.orgId,
        decision.activationToken!,
        randomBytes(24).toString("base64url"),
      );
      activatedBuyers++;
    } else pendingInvitations[c.name] = applicationRef;
  });
  setTime(at(-57, 8));

  // Suppliers.
  const supplierRows = app.procurement.suppliers(admin) as {
    id: string;
    name: string;
  }[];
  const northline = find(
    supplierRows,
    "Training HVAC Supply · FICTIONAL SAMPLE",
  ).id;
  const suppliers = {
    northline,
    controls: app.procurement.supplier(admin, key("supplier-controls"), {
      name: "Great Lakes Controls Supply",
    }).id,
    fittings: app.procurement.supplier(admin, key("supplier-fittings"), {
      name: "Huron Sheet Metal & Fittings",
    }).id,
    electrical: app.procurement.supplier(admin, key("supplier-electrical"), {
      name: "Laurentian Electrical Wholesale",
    }).id,
  };

  // Catalog: new products, tier prices, MSRP and reviewed costs.
  for (const p of fullPilotProducts)
    app.catalog.create(admin, key(`product-${p.sku}`), {
      sku: p.sku,
      name: p.name,
      serialized: "serialized" in p,
      unitPrice: p.price,
      taxBasisPoints: 1300,
    });
  const catalogRows = [
    ...greeSampleProducts.map((s) => ({
      sku: s.sku,
      price: s.price,
      cost: s.cost,
    })),
    ...fullPilotProducts.map((p) => ({
      sku: p.sku,
      price: p.price,
      cost: p.cost,
    })),
  ];
  const id: Record<string, string> = {};
  for (const row of catalogRows) {
    const productId = bySku(row.sku).id;
    id[renamedGree[row.sku]?.sku ?? row.sku] = productId;
    for (const [tier, factor] of Object.entries(tierDiscounts))
      if (!(tier === "sample-contractor" && row.sku.startsWith("SAMPLE-")))
        app.catalog.setPrice(admin, key(`price-${row.sku}-${tier}`), {
          productId,
          tier,
          unitPrice: Math.round((row.price * factor) / 100) * 100,
        });
    app.catalog.setProductMsrp(admin, key(`msrp-${row.sku}`), {
      productId,
      msrpCents: Math.round((row.price * 1.3) / 1000) * 1000 - 100,
      revision: 0,
      reason: "List price from the current price sheet",
    });
    app.catalog.setReviewedUnitCost(admin, key(`cost-${row.sku}`), {
      productId,
      unitCostCents: row.cost,
      revision: 0,
      reason: "Reviewed against the latest supplier invoice",
    });
  }
  const singleZone = [
    "GRE-CHARMO-R32",
    "GRE-PULAR-R32",
    "GRE-AIRY-R32",
    "GRE-ZENO-R32",
    "GRE-MULTI-R32",
  ];
  const addonSets: [string[], string[]][] = [
    [
      singleZone,
      [
        "ACC-INSTALL-KIT",
        "ACC-LINESET-25",
        "ACC-WALL-BRACKET",
        "ACC-STAND-GROUND",
        "ACC-PAD-36",
        "ACC-CONDENSATE-KIT",
        "ACC-PUMP-MINI",
        "ACC-DISCONNECT-60",
        "ACC-WHIP-6",
        "ACC-LINE-COVER",
      ],
    ],
    [
      ["GRE-FLEXX-ECO-R32", "GRE-FLEXX-ULTRA-R32", "HVAC-AHU-24"],
      [
        "ACC-PAD-36",
        "ACC-DISCONNECT-60",
        "ACC-WHIP-6",
        "ACC-LINESET-25",
        "CTL-THERMO-WIFI",
        "ACC-SURGE",
        "ACC-FILTER-1625",
      ],
    ],
    [
      ["GRE-CASSETTE-R32"],
      [
        "ACC-LINESET-25",
        "ACC-CONDENSATE-KIT",
        "ACC-PUMP-MINI",
        "ACC-INSTALL-KIT",
      ],
    ],
    [["HVAC-FURN-60"], ["CTL-THERMO-WIFI", "ACC-FILTER-1625", "ACC-SURGE"]],
    [["HVAC-HRV-150"], ["CTL-THERMO-WIFI", "ACC-WALL-SLEEVE"]],
  ];
  let addonPairs = 0;
  for (const [mains, addons] of addonSets)
    for (const main of mains) {
      app.catalog.setProductAddons(admin, key(`addons-${main}`), {
        productId: id[main]!,
        addonIds: addons.map((a) => id[a]!),
        revision: 0,
        reason: "Standard installation accessories for this unit",
      });
      addonPairs += addons.length;
    }

  // Customers, contacts, purchasing access and billing terms.
  const customerRows = app.identity.customers(admin) as {
    id: string;
    name: string;
  }[];
  const existing = [
    "Maple Leaf Heating",
    "Lakeside Mechanical",
    "Capital Comfort HVAC",
  ].map((name) => ({
    name,
    id: find(customerRows, `${name} · FICTIONAL SAMPLE`).id,
  }));
  const accounts: Record<string, string> = {
    ...Object.fromEntries(existing.map((c) => [c.name, c.id])),
    ...approvedAccounts,
  };
  const allProducts = Object.values(id);
  for (const c of newCustomers) {
    const review =
      c.name === "Kawartha Home Comfort" ||
      c.name === "Trillium Building Services";
    app.catalog.setPurchasingPolicy(admin, key(`purchasing-${slug(c.name)}`), {
      accountId: accounts[c.name]!,
      mode: c.name === "Kawartha Home Comfort" ? "selected" : "all",
      requiresReview: review,
      productIds:
        c.name === "Kawartha Home Comfort"
          ? [
              ...singleZone,
              "GRE-CASSETTE-R32",
              "ACC-INSTALL-KIT",
              "ACC-LINESET-25",
              "ACC-WALL-BRACKET",
              "ACC-CONDENSATE-KIT",
              "ACC-PUMP-MINI",
              "ACC-PAD-36",
              "ACC-STAND-GROUND",
            ].map((s) => id[s]!)
          : [],
      revision: 0,
      reason: review
        ? "New account: orders reviewed by sales until the first season closes"
        : "Approved contractor account",
    });
  }
  // The original three accounts were limited to the first eleven products.
  for (const c of existing)
    app.catalog.setPurchasingPolicy(admin, key(`purchasing-${slug(c.name)}`), {
      accountId: c.id,
      mode: "all",
      requiresReview: false,
      productIds: [],
      revision: app.catalog.purchasingPolicy(admin, c.id).revision,
      reason: "Extended to the full catalog",
    });
  app.catalog.setPricingPolicy(admin, key("pricing-grand-river"), {
    accountId: accounts["Grand River HVAC Services"]!,
    multiplierBp: 9700,
    displayMode: "detailed",
    revision: 0,
    reason: "Annual volume agreement",
  });
  app.catalog.setPricingPolicy(admin, key("pricing-trillium"), {
    accountId: accounts["Trillium Building Services"]!,
    multiplierBp: null,
    displayMode: "net_only",
    revision: 0,
    reason: "Customer asked to see net prices only",
  });
  let contactIndex = 0;
  for (const [name, accountId] of Object.entries(accounts)) {
    const domain = `${slug(name)}.example`;
    for (let i = 0; i < 2; i++) {
      const [person, title] =
        contactNames[contactIndex++ % contactNames.length]!;
      app.identity.contacts.save(admin, key(`contact-${slug(name)}-${i}`), {
        accountId,
        expectedRevision: 0,
        name: person,
        title,
        email: `${slug(person).split("-")[0]}@${domain}`,
        phone: `(${["416", "613", "705", "519", "905"][contactIndex % 5]}) 555-01${String(10 + contactIndex).padStart(2, "0")}`,
        archived: false,
      });
    }
  }
  const issuer = app.billing.documents.profiles(finance).issuer;
  app.billing.documents.configure(finance, key("billing-issuer"), {
    accountId: null,
    name: issuer.name || app.identity.organization(admin).name,
    address: "1200 Industrial Parkway, Unit 4\nToronto ON  M9W 0A1",
    taxRegistration: "",
    termDays: null,
    version: issuer.version,
    reason: "Issuer address for invoices and statements",
  });
  for (const [name, days] of [
    ["Grand River HVAC Services", 45],
    ["Trillium Building Services", 45],
    ["Rideau Valley Heating & Cooling", 30],
  ] as const) {
    const profile = app.billing.documents
      .profiles(finance)
      .customers.find((c) => c.accountId === accounts[name])!;
    app.billing.documents.configure(finance, key(`billing-${slug(name)}`), {
      accountId: accounts[name]!,
      name,
      address: `${newCustomers.find((c) => c.name === name)!.city} ON`,
      taxRegistration: "",
      termDays: days,
      version: profile.version,
      reason: "Terms from the signed credit application",
    });
  }
  // Dated activity runs in time order from a queue.
  const queue: { at: number; order: number; run: () => void }[] = [];
  const schedule = (time: number, run: () => void) => {
    if (time < end - 15 * 60000)
      queue.push({ at: time, order: queue.length, run });
  };
  let serialSequence = 100;
  const serials = (sku: string, count: number, day: number) => {
    const date = new Date(at(day, 9))
      .toISOString()
      .slice(2, 10)
      .replaceAll("-", "");
    const prefix = sku
      .replace(/^(GRE|HVAC)-/, "")
      .split("-")[0]!
      .slice(0, 4);
    return Array.from(
      { length: count },
      () => `${prefix}-${date}-${serialSequence++}`,
    );
  };
  const serializedSkus = new Set<string>([
    ...greeSampleProducts
      .filter((s) => !("bulk" in s))
      .map((s) => renamedGree[s.sku]!.sku),
    ...fullPilotProducts.filter((p) => "serialized" in p).map((p) => p.sku),
  ]);
  const costOf = (sku: string) =>
    catalogRows.find((r) => (renamedGree[r.sku]?.sku ?? r.sku) === sku)!.cost;
  let poCount = 0,
    receiptCount = 0;
  const purchase = (
    label: string,
    day: number,
    supplierId: string,
    warehouseId: string,
    lines: [string, number][],
    receipts: { day: number; share?: number; quarantine?: string }[],
  ) => {
    const state: { poId?: string; lines?: Record<string, string> } = {};
    schedule(at(day, 10), () => {
      const po = app.procurement.create(sales, key(`po-${label}`), {
        supplierId,
        warehouseId,
        lines: lines.map(([sku, quantity]) => ({
          productId: id[sku]!,
          quantity,
          unitCost: costOf(sku),
        })),
      });
      poCount++;
      state.poId = po.id;
      const order = app.procurement
        .orders(admin)
        .find((row) => row.id === po.id)!;
      state.lines = Object.fromEntries(
        order.lines.map((l) => [String(l.product_id), String(l.id)]),
      );
    });
    receipts.forEach((receipt, index) =>
      schedule(at(receipt.day, 13), () => {
        for (const [sku, total] of lines) {
          const quantity = Math.max(
            1,
            Math.round(total * (receipt.share ?? 1)),
          );
          app.procurement.receive(
            warehouseActor(warehouseId),
            key(`po-${label}-r${index}-${sku}`),
            {
              poId: state.poId!,
              lineId: state.lines![id[sku]!]!,
              deliveryRef: `${label.toUpperCase()}-D${index + 1}`,
              quantity,
              serials: serializedSkus.has(sku)
                ? serials(sku, quantity, receipt.day)
                : [],
              bin:
                receipt.quarantine ??
                (serializedSkus.has(sku)
                  ? `A-${String(3 + (index % 6)).padStart(2, "0")}`
                  : `B-${String(10 + (index % 9)).padStart(2, "0")}`),
              quarantine: Boolean(receipt.quarantine),
            },
          );
          receiptCount++;
        }
      }),
    );
  };

  purchase(
    "po2401",
    -56,
    suppliers.northline,
    toronto,
    [
      ["GRE-CHARMO-R32", 12],
      ["GRE-PULAR-R32", 10],
      ["GRE-AIRY-R32", 8],
      ["GRE-ZENO-R32", 6],
      ["GRE-MULTI-R32", 6],
    ],
    [{ day: -52 }],
  );
  purchase(
    "po2402",
    -56,
    suppliers.northline,
    toronto,
    [
      ["GRE-FLEXX-ECO-R32", 6],
      ["GRE-FLEXX-ULTRA-R32", 4],
      ["GRE-CASSETTE-R32", 8],
      ["HVAC-AHU-24", 4],
    ],
    [{ day: -51 }],
  );
  purchase(
    "po2403",
    -55,
    suppliers.fittings,
    toronto,
    [
      ["ACC-INSTALL-KIT", 60],
      ["ACC-PAD-36", 60],
      ["ACC-STAND-GROUND", 30],
      ["ACC-LINE-COVER", 50],
      ["ACC-WALL-SLEEVE", 120],
      ["ACC-FLARE-KIT", 100],
      ["ACC-LINESET-25", 80],
      ["ACC-WALL-BRACKET", 60],
    ],
    [{ day: -53 }],
  );
  purchase(
    "po2404",
    -55,
    suppliers.electrical,
    toronto,
    [
      ["ACC-DISCONNECT-60", 120],
      ["ACC-WHIP-6", 120],
      ["ACC-SURGE", 40],
    ],
    [{ day: -52 }],
  );
  purchase(
    "po2405",
    -54,
    suppliers.controls,
    toronto,
    [
      ["CTL-THERMO-WIFI", 40],
      ["CTL-THERMO-BASIC", 60],
      ["ACC-PUMP-MINI", 40],
      ["ACC-FILTER-1625", 80],
      ["ACC-CONDENSATE-KIT", 60],
    ],
    [{ day: -50 }],
  );
  purchase(
    "po2406",
    -54,
    suppliers.northline,
    toronto,
    [
      ["HVAC-FURN-60", 8],
      ["HVAC-HRV-150", 6],
    ],
    [{ day: -49 }],
  );
  purchase(
    "po2407",
    -50,
    suppliers.northline,
    ottawa,
    [
      ["GRE-CHARMO-R32", 6],
      ["GRE-PULAR-R32", 4],
      ["GRE-ZENO-R32", 3],
    ],
    [{ day: -46 }],
  );
  purchase(
    "po2408",
    -49,
    suppliers.fittings,
    ottawa,
    [
      ["ACC-INSTALL-KIT", 25],
      ["ACC-LINESET-25", 30],
      ["ACC-WALL-BRACKET", 20],
      ["ACC-PAD-36", 20],
    ],
    [{ day: -47 }],
  );
  purchase(
    "po2409",
    -36,
    suppliers.northline,
    toronto,
    [
      ["GRE-CHARMO-R32", 10],
      ["GRE-AIRY-R32", 6],
      ["GRE-MULTI-R32", 4],
    ],
    [{ day: -31 }],
  );
  purchase(
    "po2410",
    -30,
    suppliers.controls,
    toronto,
    [
      ["CTL-THERMO-WIFI", 30],
      ["ACC-PUMP-MINI", 20],
    ],
    [{ day: -26 }],
  );
  purchase(
    "po2411",
    -21,
    suppliers.northline,
    toronto,
    [
      ["GRE-FLEXX-ECO-R32", 4],
      ["GRE-CASSETTE-R32", 4],
      ["HVAC-FURN-60", 6],
    ],
    [
      { day: -17, share: 0.5 },
      { day: -9, share: 0.5 },
    ],
  );
  purchase(
    "po2412",
    -12,
    suppliers.fittings,
    toronto,
    [
      ["ACC-INSTALL-KIT", 40],
      ["ACC-STAND-GROUND", 20],
    ],
    [{ day: -8 }],
  );
  purchase(
    "po2413",
    -6,
    suppliers.northline,
    toronto,
    [
      ["GRE-PULAR-R32", 8],
      ["GRE-ZENO-R32", 6],
    ],
    [{ day: -2, share: 0.25, quarantine: "INSPECTION" }],
  );
  purchase(
    "po2414",
    -3,
    suppliers.electrical,
    ottawa,
    [
      ["ACC-DISCONNECT-60", 40],
      ["ACC-WHIP-6", 40],
    ],
    [],
  );

  // Sales orders, each with its own dated fulfilment and payment steps.
  type Plan = {
    label: string;
    account: string;
    warehouse?: "toronto" | "ottawa";
    day: number;
    lines: [string, number][];
    ship?: number;
    deliver?: number;
    pay?: [number, number][];
    collect?: boolean;
  };
  const plans: Plan[] = [
    {
      label: "so-1001",
      account: "Maple Leaf Heating",
      day: -48,
      lines: [
        ["GRE-CHARMO-R32", 2],
        ["ACC-INSTALL-KIT", 2],
        ["ACC-STAND-GROUND", 2],
      ],
      ship: 1,
      deliver: 2,
      pay: [[24, 1]],
    },
    {
      label: "so-1002",
      account: "Northshore Climate Systems",
      day: -47,
      lines: [
        ["GRE-PULAR-R32", 3],
        ["ACC-INSTALL-KIT", 3],
        ["ACC-WALL-BRACKET", 3],
        ["ACC-DISCONNECT-60", 3],
      ],
      ship: 2,
      deliver: 3,
      pay: [[29, 1]],
    },
    {
      label: "so-1003",
      account: "Rideau Valley Heating & Cooling",
      warehouse: "ottawa",
      day: -45,
      lines: [
        ["GRE-CHARMO-R32", 2],
        ["ACC-INSTALL-KIT", 2],
        ["ACC-LINESET-25", 2],
      ],
      ship: 1,
      deliver: 2,
      pay: [[30, 1]],
    },
    {
      label: "so-1004",
      account: "Grand River HVAC Services",
      day: -44,
      lines: [
        ["GRE-FLEXX-ECO-R32", 2],
        ["HVAC-FURN-60", 2],
        ["CTL-THERMO-WIFI", 4],
        ["ACC-PAD-36", 2],
        ["ACC-FILTER-1625", 6],
      ],
      ship: 2,
      deliver: 3,
      pay: [[40, 1]],
    },
    {
      label: "so-1005",
      account: "Niagara Air Solutions",
      day: -43,
      lines: [
        ["GRE-AIRY-R32", 2],
        ["ACC-INSTALL-KIT", 2],
        ["ACC-PUMP-MINI", 2],
      ],
      ship: 1,
      deliver: 2,
    },
    {
      label: "so-1006",
      account: "Lakeside Mechanical",
      day: -41,
      lines: [
        ["GRE-ZENO-R32", 1],
        ["GRE-MULTI-R32", 1],
        ["ACC-LINESET-25", 4],
        ["ACC-WALL-BRACKET", 2],
      ],
      ship: 2,
      deliver: 3,
      pay: [[27, 1]],
    },
    {
      label: "so-1007",
      account: "Bluewater Mechanical",
      day: -40,
      lines: [
        ["HVAC-HRV-150", 2],
        ["ACC-WALL-SLEEVE", 4],
        ["CTL-THERMO-WIFI", 2],
      ],
      ship: 1,
      deliver: 3,
      pay: [
        [20, 0.5],
        [34, 1],
      ],
    },
    {
      label: "so-1008",
      account: "Trillium Building Services",
      day: -38,
      lines: [
        ["GRE-CASSETTE-R32", 4],
        ["ACC-PUMP-MINI", 4],
        ["ACC-LINESET-25", 4],
        ["ACC-CONDENSATE-KIT", 4],
      ],
      ship: 3,
      deliver: 4,
      pay: [[36, 1]],
    },
    {
      label: "so-1009",
      account: "Capital Comfort HVAC",
      warehouse: "ottawa",
      day: -36,
      lines: [
        ["GRE-PULAR-R32", 2],
        ["ACC-INSTALL-KIT", 2],
      ],
      ship: 1,
      collect: true,
      pay: [[21, 1]],
    },
    {
      label: "so-1010",
      account: "Maple Leaf Heating",
      day: -34,
      lines: [
        ["GRE-AIRY-R32", 2],
        ["ACC-INSTALL-KIT", 2],
        ["ACC-LINE-COVER", 2],
        ["ACC-PAD-36", 2],
      ],
      ship: 1,
      deliver: 2,
      pay: [[28, 1]],
    },
    {
      label: "so-1011",
      account: "Northshore Climate Systems",
      day: -31,
      lines: [
        ["GRE-CHARMO-R32", 4],
        ["ACC-INSTALL-KIT", 4],
        ["ACC-STAND-GROUND", 4],
        ["ACC-WHIP-6", 4],
        ["ACC-DISCONNECT-60", 4],
      ],
      ship: 2,
      deliver: 3,
      pay: [[29, 0.4]],
    },
    {
      label: "so-1012",
      account: "Grand River HVAC Services",
      day: -29,
      lines: [
        ["GRE-FLEXX-ULTRA-R32", 2],
        ["HVAC-AHU-24", 2],
        ["ACC-SURGE", 4],
        ["ACC-DISCONNECT-60", 4],
      ],
      ship: 2,
      deliver: 3,
    },
    {
      label: "so-1013",
      account: "Rideau Valley Heating & Cooling",
      warehouse: "ottawa",
      day: -27,
      lines: [
        ["GRE-ZENO-R32", 2],
        ["ACC-WALL-BRACKET", 2],
        ["ACC-INSTALL-KIT", 2],
      ],
      ship: 1,
      deliver: 2,
      pay: [[24, 1]],
    },
    {
      label: "so-1014",
      account: "Bluewater Mechanical",
      day: -24,
      lines: [
        ["HVAC-FURN-60", 2],
        ["CTL-THERMO-BASIC", 4],
        ["ACC-FILTER-1625", 4],
      ],
      ship: 2,
      deliver: 3,
    },
    {
      label: "so-1015",
      account: "Lakeside Mechanical",
      day: -21,
      lines: [
        ["GRE-MULTI-R32", 2],
        ["ACC-LINESET-25", 4],
        ["ACC-PUMP-MINI", 2],
      ],
      ship: 1,
      deliver: 2,
      pay: [[18, 1]],
    },
    {
      label: "so-1016",
      account: "Maple Leaf Heating",
      day: -17,
      lines: [
        ["GRE-CHARMO-R32", 3],
        ["ACC-INSTALL-KIT", 3],
        ["ACC-WALL-BRACKET", 3],
      ],
      ship: 1,
      deliver: 2,
    },
    {
      label: "so-1017",
      account: "Trillium Building Services",
      day: -14,
      lines: [
        ["GRE-FLEXX-ECO-R32", 2],
        ["CTL-THERMO-WIFI", 2],
        ["ACC-PAD-36", 2],
      ],
      ship: 2,
      deliver: 3,
    },
    {
      label: "so-1018",
      account: "Northshore Climate Systems",
      day: -10,
      lines: [
        ["GRE-PULAR-R32", 2],
        ["ACC-INSTALL-KIT", 2],
        ["ACC-LINE-COVER", 2],
      ],
      ship: 2,
    },
    {
      label: "so-1019",
      account: "Capital Comfort HVAC",
      warehouse: "ottawa",
      day: -8,
      lines: [
        ["GRE-CHARMO-R32", 2],
        ["ACC-LINESET-25", 2],
        ["ACC-WALL-BRACKET", 2],
      ],
      ship: 1,
      deliver: 2,
    },
    {
      label: "so-1020",
      account: "Grand River HVAC Services",
      day: -6,
      lines: [
        ["HVAC-FURN-60", 3],
        ["HVAC-HRV-150", 2],
        ["CTL-THERMO-WIFI", 5],
        ["ACC-FILTER-1625", 10],
      ],
    },
    {
      label: "so-1021",
      account: "Rideau Valley Heating & Cooling",
      warehouse: "ottawa",
      day: -4,
      lines: [
        ["GRE-ZENO-R32", 1],
        ["ACC-INSTALL-KIT", 1],
      ],
      ship: 1,
    },
    {
      label: "so-1022",
      account: "Bluewater Mechanical",
      day: -3,
      lines: [
        ["GRE-AIRY-R32", 2],
        ["ACC-STAND-GROUND", 2],
        ["ACC-INSTALL-KIT", 2],
      ],
    },
    {
      label: "so-1023",
      account: "Lakeside Mechanical",
      day: -2,
      lines: [
        ["GRE-CASSETTE-R32", 2],
        ["ACC-CONDENSATE-KIT", 2],
      ],
    },
    {
      label: "so-1024",
      account: "Maple Leaf Heating",
      day: -1,
      lines: [
        ["GRE-FLEXX-ULTRA-R32", 2],
        ["ACC-PAD-36", 2],
        ["ACC-DISCONNECT-60", 2],
      ],
    },
  ];
  const orders: Record<
    string,
    {
      orderId?: string;
      shipmentId?: string;
      invoiceId?: string;
      total?: number;
    }
  > = {};
  const carts = (accountId: string, warehouseId: string) =>
    app.orders
      .carts(admin)
      .find(
        (c) => c.account_id === accountId && c.warehouse_id === warehouseId,
      );
  const placeOrder = (
    label: string,
    actor: Actor,
    accountId: string,
    warehouseId: string,
    lines: [string, number][],
    allowBackorder = false,
  ) => {
    const cart = app.orders.saveCart(actor, key(`${label}-cart`), {
      accountId,
      warehouseId,
      revision: Number(carts(accountId, warehouseId)?.revision ?? 0),
      lines: lines.map(([sku, quantity]) => ({
        productId: id[sku]!,
        quantity,
      })),
    });
    const quote = app.orders.quote(actor, key(`${label}-quote`), {
      cartId: cart.id,
      revision: cart.revision,
    });
    return app.orders.accept(actor, key(label), {
      quoteId: quote.id,
      allowBackorder,
    });
  };
  let shipmentCount = 0,
    paymentCount = 0;
  for (const plan of plans) {
    const state: (typeof orders)[string] = (orders[plan.label] = {});
    const warehouseId = plan.warehouse === "ottawa" ? ottawa : toronto;
    const orderAt = at(plan.day, 9 + (plan.label.charCodeAt(6) % 6));
    schedule(orderAt, () => {
      const result = placeOrder(
        plan.label,
        sales,
        accounts[plan.account]!,
        warehouseId,
        plan.lines,
      );
      if (result.status === "accepted") state.orderId = result.orderId;
      else {
        if (clock) clock.set(clock.now() + 8 * 60000);
        const request = app.orders.reviewRequest(sales, result.requestId);
        const approved = app.orders.decideReview(
          sales,
          key(`${plan.label}-review`),
          {
            requestId: request.id,
            revision: request.revision,
            expectedHash: request.expectedHash,
            action: "approve",
            message: "Approved. Thank you for your order.",
            staffNote: "Checked against the job quote",
          },
        );
        state.orderId = approved.orderId!;
      }
    });
    if (plan.ship === undefined) continue;
    schedule(orderAt + plan.ship * DAY, () => {
      const picker = warehouseActor(warehouseId);
      const picks = app.fulfillment.picks(picker, state.orderId!);
      for (const allocation of picks)
        app.fulfillment.pick(
          picker,
          key(`${plan.label}-pick-${allocation.id}`),
          {
            orderId: state.orderId!,
            allocationId: allocation.id,
            serial: allocation.serial,
          },
        );
      const packed = app.fulfillment.pack(picker, key(`${plan.label}-pack`), {
        orderId: state.orderId!,
        revision: app.orders.order(admin, state.orderId!).revision,
        mode: plan.collect ? "collection" : "carrier",
        address: plan.collect
          ? "Customer pickup at the trade counter"
          : `${plan.account}, ${newCustomers.find((c) => c.name === plan.account)?.city ?? "Toronto"} ON`,
        lines: picks.map((a) => ({ allocationId: a.id, quantity: a.quantity })),
      });
      const shipped = app.fulfillment.commit(
        picker,
        key(`${plan.label}-ship`),
        {
          shipmentId: packed.id,
          ...(plan.collect
            ? {}
            : {
                carrier: "Company delivery truck",
                tracking: `${warehouseId === toronto ? "TOR" : "OTT"}-RUN-${String(4100 + shipmentCount)}`,
              }),
          handoverEvidence: plan.collect
            ? "Collected at the trade counter; signature on pick slip"
            : "Loaded on the morning delivery run",
        },
      );
      shipmentCount++;
      state.shipmentId = packed.id;
      state.invoiceId = shipped.invoiceId;
      state.total = app.billing.invoice(admin, shipped.invoiceId).total;
    });
    if (plan.deliver !== undefined)
      schedule(orderAt + plan.deliver * DAY + 2 * HOUR, () => {
        app.fulfillment.confirmDelivery(
          warehouseActor(warehouseId),
          key(`${plan.label}-delivered`),
          {
            shipmentId: state.shipmentId!,
            reference: "Signed delivery slip",
            deliveredAt: new Date(Date.now() - 30 * 60000).toISOString(),
          },
        );
      });
    let paid = 0;
    for (const [index, [after, share]] of (plan.pay ?? []).entries())
      schedule(orderAt + after * DAY + 3 * HOUR, () => {
        const target = Math.round(state.total! * share);
        app.billing.manualPayment(
          finance,
          key(`${plan.label}-payment-${index}`),
          {
            invoiceId: state.invoiceId!,
            amount: target - paid,
            reference:
              index % 2
                ? `CHQ ${10480 + paymentCount}`
                : `EFT ${20260900 + paymentCount}`,
            reason:
              share < 1
                ? "Partial payment received"
                : "Payment received in full",
          },
        );
        paid = target;
        paymentCount++;
      });
  }

  // Inventory movements: transfers, counts and a supplier return.
  const stockUnit = (sku: string, warehouseId: string) =>
    app.inventory
      .stock(admin)
      .find(
        (u) =>
          u.product_id === id[sku] &&
          u.warehouse_id === warehouseId &&
          u.state === "stock" &&
          u.condition === "usable" &&
          u.quantity >= 4,
      )!;
  const transfers: string[] = [];
  schedule(at(-30, 11), () => {
    const unit = stockUnit("ACC-INSTALL-KIT", toronto);
    const transfer = app.inventory.dispatchTransfer(
      people.priya!,
      key("transfer-ottawa-kits"),
      {
        destinationId: ottawa,
        unitId: unit.id,
        quantity: 10,
        revision: unit.revision,
        reason: "Branch replenishment for the Ottawa trade counter",
      },
    );
    transfers.push(transfer.id);
  });
  schedule(at(-28, 10), () => {
    const transfer = app.inventory
      .transfers(people.marcus!)
      .find((t) => t.id === transfers[0])!;
    for (const line of transfer.lines)
      app.inventory.receiveTransfer(
        people.marcus!,
        key(`transfer-ottawa-kits-${line.line_id}`),
        {
          transferId: transfer.id,
          lineId: line.line_id,
          quantity: line.quantity,
          serial: null,
          receiptRef: "OTT-TR-0931",
          bin: "B-02",
          condition: "usable",
          reason: "Received complete",
        },
      );
  });
  schedule(at(-1, 14), () => {
    const unit = stockUnit("ACC-LINESET-25", toronto);
    transfers.push(
      app.inventory.dispatchTransfer(
        people.priya!,
        key("transfer-ottawa-linesets"),
        {
          destinationId: ottawa,
          unitId: unit.id,
          quantity: 12,
          revision: unit.revision,
          reason: "Branch replenishment, next delivery run",
        },
      ).id,
    );
  });
  const counts: string[] = [];
  for (const [label, sku, day, delta] of [
    ["count-0912", "ACC-WALL-SLEEVE", -20, 0],
    ["count-0926", "ACC-FLARE-KIT", -9, -2],
  ] as const)
    schedule(at(day, 15), () => {
      const unit = stockUnit(sku, toronto);
      const count = app.inventory.startCount(people.priya!, key(label), {
        unitId: unit.id,
        revision: unit.revision,
        countRef: label.toUpperCase(),
      });
      app.inventory.submitCount(people.priya!, key(`${label}-submit`), {
        countId: count.id,
        quantity: app.inventory.unit(admin, unit.id).quantity + delta,
        reason: delta
          ? "Two kits found opened and unusable"
          : "Cycle count matches",
      });
      counts.push(count.id);
    });
  let supplierReturns = 0;
  schedule(at(-44, 11), () => {
    const unit = stockUnit("ACC-WALL-BRACKET", toronto);
    const receipt = app.procurement
      .receipts(admin)
      .find((r) => r.candidates.some((c) => c.id === unit.id));
    if (!receipt) return;
    app.procurement.returnStock(admin, key("supplier-return-brackets"), {
      receiptId: receipt.id,
      unitId: unit.id,
      revision: unit.revision,
      quantity: 2,
      serial: null,
      returnRef: "RTV-0817",
      reason: "Two brackets arrived with bent mounting rails",
      handoverEvidence: "Returned with the supplier driver",
    });
    supplierReturns++;
  });

  // Warranty and returns on delivered equipment.
  const claims: string[] = [];
  const claim = (
    label: string,
    day: number,
    sku: string,
    issue: string,
    steps: ("approve" | "decline" | "receive" | "inspect" | "repair")[],
  ) =>
    schedule(at(day, 11), () => {
      const plan = plans.find((p) => p.label === label)!;
      const accountId = accounts[plan.account]!;
      const unit = app.inventory
        .stock(admin)
        .filter((u) => u.product_id === id[sku] && u.state === "sold")
        .find((u) => {
          try {
            return (
              app.warranty.coverage(warranty, u.id, accountId).shipmentId ===
              orders[label]!.shipmentId
            );
          } catch {
            return false;
          }
        });
      if (!unit) return;
      const created = app.warranty.submit(warranty, key(`claim-${label}`), {
        accountId,
        unitId: unit.id,
        type: "warranty",
        issue,
        evidence: "Photos and installer report on file",
      });
      claims.push(created.id);
      for (const [index, step] of steps.entries()) {
        setTime(at(day + 1 + index * 2, 10));
        if (step === "approve" || step === "decline")
          app.warranty.review(warranty, key(`claim-${label}-${step}`), {
            claimId: created.id,
            approved: step === "approve",
            reason:
              step === "approve"
                ? "Within coverage; return authorised"
                : "Damage caused by installation, not covered",
          });
        if (step === "receive")
          app.warranty.receive(
            warehouseActor(toronto),
            key(`claim-${label}-receive`),
            {
              claimId: created.id,
              warehouseId: toronto,
              bin: "RMA",
              serial: String(unit.serial),
            },
          );
        if (step === "inspect")
          app.warranty.inspect(warranty, key(`claim-${label}-inspect`), {
            claimId: created.id,
            findings: "Fan motor bearing noise confirmed on bench test",
          });
        if (step === "repair")
          app.warranty.dispose(warranty, key(`claim-${label}-repair`), {
            claimId: created.id,
            disposition: "repair",
            reason: "Motor replaced; unit returned to stock",
          });
      }
    });
  claim(
    "so-1001",
    -20,
    "GRE-CHARMO-R32",
    "Outdoor fan makes a grinding noise at start-up",
    ["approve", "receive", "inspect", "repair"],
  );
  claim("so-1007", -12, "HVAC-HRV-150", "Unit will not switch to high speed", [
    "approve",
  ]);
  claim(
    "so-1004",
    -5,
    "HVAC-FURN-60",
    "Igniter fails intermittently on cold starts",
    [],
  );
  claim(
    "so-1002",
    -16,
    "GRE-PULAR-R32",
    "Refrigerant leak at the flare connection",
    ["decline"],
  );

  // Account hold for an overdue balance.
  schedule(at(-7, 9), () =>
    app.identity.setHold(finance, key("hold-niagara"), {
      accountId: accounts["Niagara Air Solutions"]!,
      held: true,
      reason: "Invoice over 30 days past due; hold until payment",
    }),
  );

  otherApplicants.forEach((c, index) =>
    schedule(at(c.day, 11), () => {
      const applicationRef = submitApplication(c, 20 + index);
      if ("rejected" in c) {
        setTime(at(c.day + 1, 10));
        app.enrollment.decide(onboarding, applicationRef, {
          decision: "reject",
          currentPassword: onboardingPassword,
          reason: c.rejected,
        });
      }
    }),
  );
  queue.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const event of queue) {
    setTime(event.at);
    event.run();
  }

  // Current work: requests awaiting review, open carts and notes.
  setTime(end - 4 * HOUR);
  const kawartha = accounts["Kawartha Home Comfort"]!,
    trillium = accounts["Trillium Building Services"]!;
  const pending = placeOrder("rq-2001", sales, kawartha, toronto, [
    ["GRE-CHARMO-R32", 2],
    ["ACC-INSTALL-KIT", 2],
    ["ACC-PAD-36", 2],
  ]);
  const pendingLarge = placeOrder(
    "rq-2002",
    sales,
    trillium,
    toronto,
    [
      ["GRE-FLEXX-ECO-R32", 2],
      ["HVAC-AHU-24", 2],
      ["CTL-THERMO-WIFI", 4],
    ],
    true,
  );
  app.orders.saveCart(sales, key("cart-northshore"), {
    accountId: accounts["Northshore Climate Systems"]!,
    warehouseId: toronto,
    revision: Number(
      carts(accounts["Northshore Climate Systems"]!, toronto)?.revision ?? 0,
    ),
    lines: [
      { productId: id["GRE-ZENO-R32"]!, quantity: 2 },
      { productId: id["ACC-INSTALL-KIT"]!, quantity: 2 },
    ],
  });
  app.catalog.setProductAvailability(admin, key("availability-ahu"), {
    productId: id["HVAC-AHU-24"]!,
    hidden: false,
    outOfStock: true,
    expectedAvailableOn: new Date(end + 18 * DAY).toISOString().slice(0, 10),
    revision: 0,
    reason: "Supplier confirmed the next shipment date",
  });
  for (const applicationRef of Object.values(pendingInvitations))
    app.enrollment.invitation(onboarding, applicationRef, {
      action: "reissue",
      currentPassword: onboardingPassword,
      reason: "Owner asked for a fresh activation link",
    });
  const notes: [string, string, string][] = [
    [
      "customer",
      accounts["Niagara Air Solutions"]!,
      "Spoke with accounts payable; payment promised by end of week.",
    ],
    [
      "customer",
      accounts["Grand River HVAC Services"]!,
      "Prefers deliveries before 10 a.m. at the Kitchener yard.",
    ],
    [
      "customer",
      kawartha,
      "New account. Sales reviews each order until the first season closes.",
    ],
    [
      "product",
      id["HVAC-AHU-24"]!,
      "Next shipment confirmed with the supplier; customers may backorder.",
    ],
    [
      "order",
      orders["so-1020"]!.orderId!,
      "Customer asked to hold until the site is ready; call before picking.",
    ],
  ];
  for (const [index, [kind, recordId, body]] of notes.entries())
    app.notes.add(kind === "customer" ? sales : admin, key(`note-${index}`), {
      kind: kind as "customer",
      recordId,
      body,
    });

  // Retire the SAMPLE labels through the audited rename commands.
  setTime(end - HOUR);
  const renameReason = "Use the catalog and account names shown to customers";
  for (const sample of greeSampleProducts) {
    const target = renamedGree[sample.sku]!;
    app.catalog.rename(admin, key(`rename-${sample.sku}`), {
      productId: id[target.sku]!,
      sku: target.sku,
      name: target.name,
      expectedSku: sample.sku,
      expectedName: sample.name,
      reason: renameReason,
    });
  }
  for (const c of existing)
    app.identity.renameCustomer(admin, key(`rename-${slug(c.name)}`), {
      accountId: c.id,
      name: c.name,
      expectedName: `${c.name} · FICTIONAL SAMPLE`,
      reason: renameReason,
    });
  app.inventory.renameWarehouse(admin, key("rename-toronto"), {
    warehouseId: toronto,
    name: "Toronto distribution centre",
    expectedName: "Toronto HVAC · SAMPLE",
    reason: renameReason,
  });
  app.inventory.renameWarehouse(admin, key("rename-ottawa"), {
    warehouseId: ottawa,
    name: "Ottawa branch",
    expectedName: "Ottawa HVAC · SAMPLE",
    reason: renameReason,
  });
  app.procurement.renameSupplier(admin, key("rename-northline"), {
    supplierId: northline,
    name: "Northline HVAC Supply",
    expectedName: "Training HVAC Supply · FICTIONAL SAMPLE",
    reason: renameReason,
  });

  return {
    products: fullPilotProducts.length,
    addonPairs,
    customers: newCustomers.length,
    staffUsers: staff.length + 1,
    applications: applications + otherApplicants.length,
    activatedBuyers,
    purchaseOrders: poCount,
    receipts: receiptCount,
    salesOrders: plans.length,
    shipments: shipmentCount,
    payments: paymentCount,
    transfers: transfers.length,
    counts: counts.length,
    supplierReturns,
    warrantyClaims: claims.length,
    reviewRequests: [pending, pendingLarge].filter(
      (r) => r.status === "awaiting_approval",
    ).length,
    notes: notes.length,
  };
}
