import { useMemo } from "react";
import { useColorScheme } from "react-native";
import type { Theme } from "./theme";
import { themeFor } from "./theme";

/** useTheme 跟随系统亮暗返回当前色板；App 内没有手动主题开关。 */
export function useTheme(): Theme {
	const scheme = useColorScheme();
	return themeFor(scheme);
}

/**
 * useThemedStyles 把「色板 → StyleSheet」的工厂缓存起来。
 *
 * 工厂必须定义在模块顶层（引用稳定），否则每次渲染都会重建样式表。
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
	const theme = useTheme();
	return useMemo(() => factory(theme), [factory, theme]);
}
