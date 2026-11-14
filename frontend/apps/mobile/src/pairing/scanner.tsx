import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { type PairPayload, parsePairLink } from "./link";

export interface PairScannerProps {
	visible: boolean;
	onClose: () => void;
	onScanned: (payload: PairPayload) => void;
}

/**
 * PairScanner 用相机扫控制面打印的配对二维码。
 *
 * 只在识别出合法链接时回调一次：相机每帧都会回调，必须用 ref 去重，
 * 否则一次扫描会连续触发多次连接。识别失败不解码、不关闭，让用户重扫。
 */
export function PairScanner({ visible, onClose, onScanned }: PairScannerProps) {
	const [permission, requestPermission] = useCameraPermissions();
	const [error, setError] = useState<string | null>(null);
	const handled = useRef(false);

	useEffect(() => {
		if (!visible) {
			handled.current = false;
			setError(null);
			return;
		}
		if (permission && !permission.granted && permission.canAskAgain) {
			void requestPermission();
		}
	}, [permission, requestPermission, visible]);

	const handleBarcode = (data: string) => {
		if (handled.current) return;
		try {
			const payload = parsePairLink(data);
			handled.current = true;
			onScanned(payload);
		} catch (scanError) {
			setError(scanError instanceof Error ? scanError.message : "二维码无法识别");
		}
	};

	const askForPermission = () => {
		if (permission?.canAskAgain === false) {
			void Linking.openSettings();
			return;
		}
		void requestPermission();
	};

	return (
		<Modal visible={visible} animationType="slide" onRequestClose={onClose}>
			<View style={styles.screen}>
				{permission?.granted ? (
					<CameraView
						style={StyleSheet.absoluteFill}
						facing="back"
						barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
						onBarcodeScanned={({ data }) => handleBarcode(data)}
					/>
				) : (
					<View style={styles.permission}>
						<Text style={styles.permissionText}>
							{permission?.canAskAgain === false
								? "相机权限已被拒绝，请到系统设置里开启。"
								: "需要相机权限才能扫描配对二维码。"}
						</Text>
						<Pressable style={styles.button} onPress={askForPermission}>
							<Text style={styles.buttonText}>
								{permission?.canAskAgain === false ? "打开系统设置" : "允许使用相机"}
							</Text>
						</Pressable>
					</View>
				)}

				<View style={styles.hintWrap} pointerEvents="none">
					<Text style={styles.hint}>对准控制面启动时打印的二维码</Text>
					{error ? <Text style={styles.error}>{error}</Text> : null}
				</View>

				<Pressable style={styles.close} onPress={onClose} accessibilityRole="button">
					<Text style={styles.closeText}>关闭</Text>
				</Pressable>
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: "#000" },
	permission: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 12,
		paddingHorizontal: 24,
	},
	permissionText: { color: "#e2e8f0", fontSize: 14, textAlign: "center" },
	button: {
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 10,
		backgroundColor: "#f8fafc",
	},
	buttonText: { color: "#0f172a", fontSize: 15, fontWeight: "600" },
	hintWrap: { position: "absolute", left: 0, right: 0, bottom: 96, alignItems: "center", gap: 6 },
	hint: { color: "#e2e8f0", fontSize: 14 },
	error: { color: "#fca5a5", fontSize: 13, paddingHorizontal: 24, textAlign: "center" },
	close: {
		position: "absolute",
		bottom: 32,
		alignSelf: "center",
		paddingHorizontal: 24,
		paddingVertical: 10,
		borderRadius: 10,
		backgroundColor: "rgba(248,250,252,0.16)",
	},
	closeText: { color: "#f8fafc", fontSize: 15, fontWeight: "600" },
});
