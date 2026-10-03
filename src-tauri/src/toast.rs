//! Windows notifications for Electron's Notification class (scripts/alerts-host.cjs
//! is the only user). A toast is shown under the app id main.cjs sets
//! (MefiStudio.StudioAIPlus); an unpackaged program's id needs its display name
//! and icon under HKCU\Software\Classes\AppUserModelId for Windows to show it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::json;
use windows::core::{IInspectable, HSTRING};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::{ToastDismissedEventArgs, ToastFailedEventArgs, ToastNotification, ToastNotificationManager};

use crate::engine::Engine;

fn app_id() -> &'static Mutex<String> {
    static ID: OnceLock<Mutex<String>> = OnceLock::new();
    ID.get_or_init(|| Mutex::new("MefiStudio.StudioAIPlus".into()))
}

fn shown() -> &'static Mutex<HashMap<u64, ToastNotification>> {
    static SHOWN: OnceLock<Mutex<HashMap<u64, ToastNotification>>> = OnceLock::new();
    SHOWN.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn set_app_id(id: &str, display_name: &str, icon: Option<&std::path::Path>) {
    if id.is_empty() {
        return;
    }
    if let Ok(mut slot) = app_id().lock() {
        *slot = id.to_string();
    }
    let key = format!(r"Software\Classes\AppUserModelId\{id}");
    crate::native::platform::set_registry_string(&key, "DisplayName", display_name);
    if let Some(icon) = icon.filter(|path| path.is_file()) {
        crate::native::platform::set_registry_string(&key, "IconUri", &icon.to_string_lossy());
    }
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

pub fn toast_xml(title: &str, body: &str, silent: bool) -> String {
    format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>{}</toast>",
        escape(title),
        escape(body),
        if silent { "<audio silent=\"true\"/>" } else { "" }
    )
}

pub fn show(engine: &Arc<Engine>, id: u64, title: &str, body: &str, silent: bool) -> Result<(), String> {
    let run = || -> windows::core::Result<()> {
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(toast_xml(title, body, silent)))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        toast.SetTag(&HSTRING::from(id.to_string()))?;
        toast.SetGroup(&HSTRING::from("mefi"))?;
        let clicked = engine.clone();
        toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
            clicked.event("notification:click", json!({ "id": id }));
            shown().lock().ok().map(|mut map| map.remove(&id));
            Ok(())
        }))?;
        let dismissed = engine.clone();
        toast.Dismissed(&TypedEventHandler::<ToastNotification, ToastDismissedEventArgs>::new(move |_, _| {
            dismissed.event("notification:close", json!({ "id": id }));
            shown().lock().ok().map(|mut map| map.remove(&id));
            Ok(())
        }))?;
        let failed = engine.clone();
        toast.Failed(&TypedEventHandler::<ToastNotification, ToastFailedEventArgs>::new(move |_, args| {
            let code = args.as_ref().and_then(|args| args.ErrorCode().ok()).map(|code| format!("{code:?}")).unwrap_or_default();
            failed.event("notification:failed", json!({ "id": id, "error": code }));
            shown().lock().ok().map(|mut map| map.remove(&id));
            Ok(())
        }))?;
        let id_text = app_id().lock().map(|id| id.clone()).unwrap_or_default();
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(id_text))?;
        notifier.Show(&toast)?;
        if let Ok(mut map) = shown().lock() {
            map.insert(id, toast);
        }
        Ok(())
    };
    run().map_err(|error| format!("Windows did not show the notification: {}", error.message()))
}

pub fn close(id: u64) {
    let toast = shown().lock().ok().and_then(|mut map| map.remove(&id));
    let id_text = app_id().lock().map(|id| id.clone()).unwrap_or_default();
    if let (Some(toast), Ok(notifier)) = (toast, ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(id_text))) {
        let _ = notifier.Hide(&toast);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn toast_text_is_escaped() {
        let xml = super::toast_xml("3 <need> you", "Tom & Jerry's \"plan\"", true);
        assert!(xml.contains("<text>3 &lt;need&gt; you</text>"));
        assert!(xml.contains("Tom &amp; Jerry&apos;s &quot;plan&quot;"));
        assert!(xml.ends_with("<audio silent=\"true\"/></toast>"));
    }
}
