import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/** Reflection over android.jar stubs to confirm the APIs the app calls exist. */
public class CheckApi {
    static boolean bad = false;

    static void has(String cls, String name, String... paramTypes) {
        try {
            Class<?> c = Class.forName(cls);
            Method found = null;
            for (Method m : c.getDeclaredMethods()) {
                if (!m.getName().equals(name)) continue;
                Class<?>[] ps = m.getParameterTypes();
                if (ps.length != paramTypes.length) continue;
                boolean ok = true;
                for (int i = 0; i < ps.length; i++) {
                    String simple = ps[i].getName();
                    if (!simple.equals(paramTypes[i]) && !simple.endsWith("." + paramTypes[i])) {
                        ok = false; break;
                    }
                }
                if (ok) { found = m; break; }
            }
            if (found == null) {
                System.out.println("MISSING  " + cls + "." + name + "(" + String.join(",", paramTypes) + ")");
                bad = true;
            } else {
                System.out.println("ok       " + cls + "." + name + " -> " + found.getReturnType().getSimpleName()
                        + (Modifier.isStatic(found.getModifiers()) ? " [static]" : ""));
            }
        } catch (Throwable t) {
            System.out.println("MISSING CLASS " + cls + " : " + t);
            bad = true;
        }
    }

    static void field(String cls, String name) {
        try {
            Class<?> c = Class.forName(cls);
            c.getField(name);
            System.out.println("ok       " + cls + "." + name);
        } catch (Throwable t) {
            System.out.println("MISSING  " + cls + "." + name);
            bad = true;
        }
    }

    public static void main(String[] a) {
        has("android.webkit.WebSettings", "getDefaultUserAgent", "Context");
        has("android.webkit.WebView", "getCurrentWebViewPackage");
        has("android.webkit.WebSettings", "setForceDark", "int");
        field("android.webkit.WebSettings", "FORCE_DARK_OFF");
        field("android.webkit.WebSettings", "MIXED_CONTENT_COMPATIBILITY_MODE");
        has("android.webkit.WebSettings", "setMixedContentMode", "int");
        has("android.webkit.WebSettings", "setMediaPlaybackRequiresUserGesture", "boolean");
        has("android.webkit.WebSettings", "setJavaScriptCanOpenWindowsAutomatically", "boolean");
        has("android.webkit.WebSettings", "setSupportMultipleWindows", "boolean");
        has("android.webkit.WebSettings", "setDomStorageEnabled", "boolean");
        has("android.webkit.WebSettings", "setDatabaseEnabled", "boolean");
        has("android.webkit.WebSettings", "setAllowFileAccess", "boolean");
        has("android.webkit.WebSettings", "setAllowContentAccess", "boolean");
        has("android.webkit.WebView", "evaluateJavascript", "String", "ValueCallback");
        has("android.webkit.WebView", "addJavascriptInterface", "Object", "String");
        has("android.webkit.WebView", "setWebContentsDebuggingEnabled", "boolean");
        has("android.view.Window", "setDecorFitsSystemWindows", "boolean");
        has("android.view.Window", "getInsetsController");
        has("android.view.WindowInsetsController", "hide", "int");
        has("android.view.WindowInsetsController", "setSystemBarsBehavior", "int");
        field("android.view.WindowInsetsController", "BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE");
        field("android.view.WindowInsets", "Type");
        has("android.webkit.WebViewClient", "onReceivedError", "WebView", "WebResourceRequest", "WebResourceError");
        has("android.webkit.WebResourceError", "getDescription");
        has("android.webkit.WebResourceRequest", "isForMainFrame");
        has("android.webkit.WebChromeClient", "onConsoleMessage", "ConsoleMessage");
        System.out.println(bad ? "\n=== RESULT: PROBLEMS FOUND ===" : "\n=== RESULT: ALL APIS PRESENT ===");
    }
}
