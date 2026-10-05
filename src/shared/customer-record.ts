export type CustomerContact = {
  id: string;
  accountId: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  archived: boolean;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};
export type CustomerContacts = { items: CustomerContact[]; canManage: boolean };
export type SaveCustomerContact = {
  accountId: string;
  contactId?: string;
  expectedRevision: number;
  name: string;
  title: string;
  email: string;
  phone: string;
  archived: boolean;
};
