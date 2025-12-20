"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivilegeEnum = exports.DocType = exports.DocumentPublic = void 0;
var DocumentPublic;
(function (DocumentPublic) {
    DocumentPublic[DocumentPublic["private"] = 0] = "private";
    DocumentPublic[DocumentPublic["publicView"] = 1] = "publicView";
    DocumentPublic[DocumentPublic["publicEdit"] = 2] = "publicEdit";
})(DocumentPublic || (exports.DocumentPublic = DocumentPublic = {}));
var DocType;
(function (DocType) {
    DocType[DocType["text"] = 0] = "text";
    DocType[DocType["canvas"] = 1] = "canvas";
    DocType[DocType["mix"] = 2] = "mix";
    DocType[DocType["todo"] = 3] = "todo";
})(DocType || (exports.DocType = DocType = {}));
var PrivilegeEnum;
(function (PrivilegeEnum) {
    PrivilegeEnum[PrivilegeEnum["none"] = 0] = "none";
    /** User can view the doc */
    PrivilegeEnum[PrivilegeEnum["viewer"] = 1000] = "viewer";
    /** User can edit the doc */
    PrivilegeEnum[PrivilegeEnum["editor"] = 2000] = "editor";
    /** User can delete or share document */
    PrivilegeEnum[PrivilegeEnum["owner"] = 3000] = "owner";
})(PrivilegeEnum || (exports.PrivilegeEnum = PrivilegeEnum = {}));
