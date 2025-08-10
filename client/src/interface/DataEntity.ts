export interface UserEntity {
  id: string;
  password: string;
  salt: string;
  wrong_pass_word_count: number;
  last_login_time: string;
}

export enum DocumentPublic {
  private = 0,
  publicView = 1,
  publicEdit = 2,
}

export enum DocType {
  text = 0,
  canvas = 1,
  mix = 2,
}

export interface DocumentEntity {
  id: string;
  title: string;
  user_id: string;
  create_date: string;
  last_modify_date: string;
  state: ArrayBuffer | null;
  is_public: DocumentPublic;
  commit_id: number;
  // default is text
  doc_type: DocType;
  encrypt_salt?: string;
}

export type DocumentEntityBase64 = Omit<DocumentEntity, "state"> & {
  state: string | null;
};

export enum PrivilegeEnum {
  none = 0,

  /** User can view the doc */
  viewer = 1000,

  /** User can edit the doc */
  editor = 2000,

  /** User can delete or share document */
  owner = 3000,
}

export interface DocPrivilegeEntity {
  doc_id: string;
  user_id: string;
  group_id: string;
  privilege: PrivilegeEnum;
}
