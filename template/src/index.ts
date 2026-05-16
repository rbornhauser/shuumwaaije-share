import { R2Explorer } from "r2-explorer";

// Read all available configurations here: https://r2explorer.com/getting-started/configuration/
export default R2Explorer({
	readonly: false,
	basicAuth: [
		{ username: "member1", password: "memberpass", groups: ["members"] },
		{ username: "board1", password: "boardpass", groups: ["board"] },
		{ username: "auditor1", password: "auditpass", groups: ["auditors"] },
		{ username: "instructor1", password: "instructorpass", groups: ["instructors"] },
	],
	bucketPermissions: {
		Trommeln: {
			read: [
				{ groups: ["members", "board", "auditors", "instructors"], prefixes: [""] },
			],
			write: [
				{ groups: ["board", "instructors"], prefixes: [""] },
			],
		},
		Verein: {
			read: [
				{ groups: ["members", "board", "auditors", "instructors"], prefixes: [""] },
			],
			write: [
				{ groups: ["board"], prefixes: ["GV/", "Buchhaltung/", "Dokumente/"] },
			],
		},
		Fotos: {
			read: [
				{ groups: ["members", "board", "auditors", "instructors"], prefixes: [""] },
			],
			write: [
				{ groups: ["members", "board", "auditors", "instructors"], prefixes: [""] },
			],
		},
	},
});
