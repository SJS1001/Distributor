import React from "react";
import type {
  CarrierReview,
  DhlShippingReview,
} from "../shared/carrier-booking.ts";

const incoterms = ["DAP", "FCA", "EXW", "CPT", "CIP", "DPU"] as const;
const invoiceTypes = ["commercial", "proforma", "returns"] as const;
const reasons = [
  ["commercial_purpose_or_sale", "Commercial purpose or sale"],
  ["return", "Return"],
  ["warranty_replacement", "Warranty replacement"],
  ["sample", "Sample"],
  ["gift", "Gift"],
  ["temporary", "Temporary export"],
] as const;
function Choice({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label>
      {label}
      <select name={name} required defaultValue="">
        <option value="" disabled>
          Choose {label.toLowerCase()}
        </option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function DhlDeclarationFields({
  goods,
  originCountry,
  destinationCountry,
}: {
  goods: CarrierReview["packedGoods"];
  originCountry: string;
  destinationCountry: string;
}) {
  const cross =
    !!originCountry &&
    !!destinationCountry &&
    originCountry !== destinationCountry;
  return (
    <fieldset style={{ minWidth: 0 }}>
      <legend>DHL shipping declaration</legend>
      <p>
        Enter the companies separately from the address contact names. Review
        the agreed Incoterm and tender time, including the warehouse’s UTC
        offset on that date.
      </p>
      <label>
        Shipper company
        <input name="dhl.shipper" required maxLength={100} />
      </label>
      <label>
        Receiver company
        <input name="dhl.receiver" required maxLength={100} />
      </label>
      <label>
        Planned shipping date and time
        <input name="dhl.localTime" type="datetime-local" step={1} required />
      </label>
      <label>
        UTC offset at shipping time
        <input
          name="dhl.offset"
          required
          pattern="[+-][0-9]{2}:[0-9]{2}"
          placeholder="-04:00"
        />
      </label>
      <label>
        Shipment goods description
        <input name="dhl.description" required maxLength={70} />
      </label>
      <Choice
        name="dhl.incoterm"
        label="Incoterm"
        options={incoterms.map((v) => [v, v])}
      />
      {(!originCountry || !destinationCountry) && (
        <p>
          Choose both address countries to review the declaration requirements.
        </p>
      )}
      {originCountry && destinationCountry && !cross && (
        <p>Domestic shipment: no customs declaration will be submitted.</p>
      )}
      {cross && (
        <fieldset
          key={`${originCountry}:${destinationCountry}`}
          style={{ minWidth: 0 }}
        >
          <legend>Cross-border customs declaration</legend>
          <p>
            Declare every packed line and its full quantity below. Enter the
            reviewed customs values; order prices are not used. Changing either
            address country clears this customs entry.
          </p>
          <Choice
            name="dhl.currency"
            label="Declaration currency"
            options={[
              ["USD", "USD"],
              ["CAD", "CAD"],
            ]}
          />
          <Choice
            name="dhl.invoiceType"
            label="Customs invoice type"
            options={invoiceTypes.map((v) => [v, v])}
          />
          <label>
            Customs invoice number
            <input name="dhl.invoiceNumber" required maxLength={35} />
          </label>
          <label>
            Customs invoice date
            <input name="dhl.invoiceDate" type="date" required />
          </label>
          <Choice
            name="dhl.exportReason"
            label="Export reason"
            options={reasons}
          />
          {goods.map((line, i) => (
            <fieldset key={line.allocationId} style={{ minWidth: 0 }}>
              <legend>Packed goods {i + 1}</legend>
              <p>
                {line.description} · Quantity: {line.quantity}
                {line.serial ? ` · Serial: ${line.serial}` : " · Bulk goods"}
              </p>
              <p>Packed allocation: {line.allocationId}</p>
              <label>
                Declared goods description
                <input
                  name={`dhl.line.${i}.description`}
                  required
                  maxLength={512}
                />
              </label>
              <label>
                Declared value per unit
                <input
                  name={`dhl.line.${i}.value`}
                  required
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  placeholder="123.45"
                />
              </label>
              <label>
                Country of manufacture (two-letter code)
                <input
                  name={`dhl.line.${i}.country`}
                  required
                  pattern="[A-Z]{2}"
                  maxLength={2}
                />
              </label>
              <label>
                Commodity code
                <input
                  name={`dhl.line.${i}.commodity`}
                  required
                  pattern="[0-9]{6,18}"
                  inputMode="numeric"
                  maxLength={18}
                />
              </label>
              <label>
                Total line net weight (grams)
                <input
                  name={`dhl.line.${i}.weight`}
                  required
                  type="number"
                  min={1}
                  step={1}
                />
              </label>
            </fieldset>
          ))}
          {goods.length === 0 && (
            <p role="alert">
              Packed goods are unavailable. Refresh the carrier review before
              preparing a cross-border shipment.
            </p>
          )}
          <label>
            Customs review acknowledgment / evidence
            <textarea
              name="dhl.customsAcknowledgment"
              required
              maxLength={1000}
            />
          </label>
          <label>
            <input
              style={{ width: "auto" }}
              name="dhl.customsConfirmed"
              type="checkbox"
              required
            />
            I reviewed every packed line, its full quantity, declared value,
            manufacture country, commodity code and net weight.
          </label>
        </fieldset>
      )}
    </fieldset>
  );
}
// Currency entry is decimal money, converted exactly without floating rounding,
// locale guessing or implicit FX. The server remains the declaration authority.
export function readDhlDeclaration(
  form: FormData,
  goods: CarrierReview["packedGoods"],
  cross: boolean,
): DhlShippingReview {
  const value = (name: string) => String(form.get(`dhl.${name}`) ?? "");
  const local = value("localTime");
  const plannedShippingAt = `${local.length === 16 ? local + ":00" : local}${value("offset")}`;
  const result: DhlShippingReview = {
    companyNames: { shipper: value("shipper"), receiver: value("receiver") },
    plannedShippingAt,
    description: value("description"),
    incoterm: value("incoterm") as DhlShippingReview["incoterm"],
  };
  if (!cross) return result;
  if (form.get("dhl.customsConfirmed") !== "on" || !goods.length)
    throw Error(
      "Review every packed line before preparing the customs declaration.",
    );
  result.customs = {
    currency: value("currency") as "USD" | "CAD",
    invoiceType: value("invoiceType") as "commercial" | "proforma" | "returns",
    invoiceNumber: value("invoiceNumber"),
    invoiceDate: value("invoiceDate"),
    exportReason: value("exportReason") as NonNullable<
      DhlShippingReview["customs"]
    >["exportReason"],
    acknowledgment: value("customsAcknowledgment"),
    lines: goods.map((line, i) => {
      const amount = value(`line.${i}.value`);
      if (!/^[0-9]{1,11}(?:\.[0-9]{1,2})?$/.test(amount))
        throw Error(
          "Enter each declared unit value as a positive amount with at most two decimal places.",
        );
      const [whole, fraction = ""] = amount.split(".");
      const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
      if (minor <= 0n || minor > 1_000_000_000_000n)
        throw Error(
          "Declared unit values must be positive and no greater than 10,000,000,000.00.",
        );
      return {
        allocationId: line.allocationId,
        quantity: line.quantity,
        description: value(`line.${i}.description`),
        unitValueMinor: Number(minor),
        manufacturerCountry: value(`line.${i}.country`),
        commodityCode: value(`line.${i}.commodity`),
        netWeightGrams: Number(value(`line.${i}.weight`)),
      };
    }),
  };
  return result;
}
const money = (minor: bigint, currency: string) =>
  `${currency} ${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
export function DhlDeclarationDetail({
  declaration,
}: {
  declaration: DhlShippingReview;
}) {
  const customs = declaration.customs;
  return (
    <section aria-label="Retained DHL declaration">
      <h5>Retained DHL declaration</h5>
      <p>
        Shipper company:{" "}
        {declaration.companyNames?.shipper ??
          "Not retained in this historical review"}
      </p>
      <p>
        Receiver company:{" "}
        {declaration.companyNames?.receiver ??
          "Not retained in this historical review"}
      </p>
      <p>Planned shipping time: {declaration.plannedShippingAt}</p>
      <p>
        Goods description: {declaration.description} · Incoterm:{" "}
        {declaration.incoterm}
      </p>
      {customs ? (
        <>
          <p>
            Customs invoice: {customs.invoiceNumber} · {customs.invoiceDate} ·{" "}
            {customs.invoiceType ??
              "Invoice type not retained in this historical review"}
          </p>
          <p>
            Export reason:{" "}
            {reasons.find(([v]) => v === customs.exportReason)?.[1] ??
              customs.exportReason}
          </p>
          <ol>
            {customs.lines.map((line) => (
              <li key={line.allocationId}>
                <p>
                  {line.description} · Quantity: {line.quantity} · Allocation:{" "}
                  {line.allocationId}
                </p>
                <p>
                  Unit value:{" "}
                  {money(BigInt(line.unitValueMinor), customs.currency)} · Line
                  value:{" "}
                  {money(
                    BigInt(line.unitValueMinor) * BigInt(line.quantity),
                    customs.currency,
                  )}
                </p>
                <p>
                  Manufacture country: {line.manufacturerCountry} · Commodity
                  code: {line.commodityCode} · Total line net weight:{" "}
                  {line.netWeightGrams} grams
                </p>
              </li>
            ))}
          </ol>
          <p>
            Total declared value:{" "}
            {money(
              customs.lines.reduce(
                (total, line) =>
                  total + BigInt(line.unitValueMinor) * BigInt(line.quantity),
                0n,
              ),
              customs.currency,
            )}
          </p>
          <p>Customs review evidence: {customs.acknowledgment}</p>
        </>
      ) : (
        <p>Domestic shipment: no customs declaration retained.</p>
      )}
    </section>
  );
}
