import { boot } from "./boot.ts";

boot((adapter) => {
	registerUserActionsMenu((window) => ({
		text: "Float umschalten (kxl-dev)",
		checkable: true,
		checked: adapter.isFloating(window),
		triggered: () => {
			adapter.toggleFloat(window);
		},
	}));
});
