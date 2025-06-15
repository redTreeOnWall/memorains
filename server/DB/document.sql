
DROP TABLE IF EXISTS `doc_privilege`;

CREATE TABLE `doc_privilege` (
  `doc_id` varchar(128) DEFAULT NULL,
  `user_id` varchar(128) DEFAULT NULL,
  `group_id` varchar(128) DEFAULT NULL,
  `privilege` int(11) DEFAULT NULL,
  KEY `doc_privilege_doc_id_IDX` (`doc_id`) USING BTREE,
  KEY `doc_privilege_user_id_IDX` (`user_id`) USING BTREE,
  KEY `doc_privilege_group_id_IDX` (`group_id`) USING BTREE,
  KEY `doc_privilege_privilege_IDX` (`privilege`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `document`;

CREATE TABLE `document` (
  `id` varchar(128) NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `user_id` varchar(128) DEFAULT NULL,
  `create_date` datetime DEFAULT NULL,
  `last_modify_date` datetime DEFAULT NULL,
  `state` mediumblob DEFAULT NULL,
  KEY `document_id_IDX` (`id`) USING BTREE,
  KEY `document_user_id_IDX` (`user_id`) USING BTREE,
  KEY `document_last_modify_date_IDX` (`last_modify_date`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `user`;

CREATE TABLE `user` (
  `id` varchar(128) NOT NULL,
  `password` varchar(256) NOT NULL,
  `salt` varchar(128) NOT NULL,
  KEY `user_id_IDX` (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE document.document ADD is_public INTEGER DEFAULT 0 NULL;
CREATE INDEX document_is_public_IDX USING BTREE ON document.document (is_public);
ALTER TABLE document.document ADD commit_id INTEGER DEFAULT 0 NULL;
ALTER TABLE document.document MODIFY COLUMN state longBLOB DEFAULT NULL NULL;
ALTER TABLE document.`user` ADD wrong_pass_word_count INT DEFAULT 0 NULL;
ALTER TABLE document.`user` ADD last_login_time datetime DEFAULT NULL NULL;

ALTER TABLE document.document ADD doc_type INT DEFAULT 0 NULL;
CREATE INDEX document_doc_type_IDX USING BTREE ON document.document (doc_type);

ALTER TABLE document.document ADD encrypt_salt varchar(128) DEFAULT NULL NULL;

