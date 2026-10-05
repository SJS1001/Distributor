export type ScannerLinkChannel = "email" | "sms";
export type ScannerLinkInput = {
  channel: ScannerLinkChannel;
  recipient: string;
};
export type ScannerLinkReceipt = {
  id: string;
  channel: ScannerLinkChannel;
  recipientHint: string;
  state: "unknown" | "accepted" | "confirmed" | "rejected";
  createdAt: string;
};
export type ScannerLinkConfiguration = {
  scope: string;
  channels: ScannerLinkChannel[];
};
