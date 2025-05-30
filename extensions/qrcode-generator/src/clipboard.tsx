import { Clipboard, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { generateQRCode, QRCodeView } from "./utils";

export default function Command() {
  const [qrData, setQrData] = useState<string>();

  useEffect(() => {
    (async () => {
      const clipboard = await Clipboard.readText();
      const qrData = await generateQRCode(clipboard);
      setQrData(qrData);
      showToast(Toast.Style.Success, "Success", "Created QR Code");
    })();
  }, []);

  return <QRCodeView qrData={qrData || ""} height={355} />;
}
