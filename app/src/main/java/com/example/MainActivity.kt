package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {

  private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

  // File / Camera chooser launcher
  private val fileChooserLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) { result ->
    if (result.resultCode == Activity.RESULT_OK) {
      val data: Intent? = result.data
      val clipData = data?.clipData
      val uriList = mutableListOf<Uri>()

      if (clipData != null) {
        for (i in 0 until clipData.itemCount) {
          uriList.add(clipData.getItemAt(i).uri)
        }
      } else if (data?.data != null) {
        uriList.add(data.data!!)
      }

      fileChooserCallback?.onReceiveValue(uriList.toTypedArray())
    } else {
      fileChooserCallback?.onReceiveValue(null)
    }
    fileChooserCallback = null
  }

  // Permission launcher for Location and Camera
  private val permissionsLauncher = registerForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions()
  ) { permissions ->
    // Permissions handled
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    requestAppPermissions()

    setContent {
      MyApplicationTheme {
        Scaffold(
          modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
        ) { innerPadding ->
          PcpWebViewScreen(
            onOpenFileChooser = { callback, intent ->
              fileChooserCallback = callback
              fileChooserLauncher.launch(intent)
            }
          )
        }
      }
    }
  }

  private fun requestAppPermissions() {
    val permissionsToRequest = mutableListOf<String>()

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      permissionsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      permissionsToRequest.add(Manifest.permission.ACCESS_COARSE_LOCATION)
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      permissionsToRequest.add(Manifest.permission.CAMERA)
    }

    if (permissionsToRequest.isNotEmpty()) {
      permissionsLauncher.launch(permissionsToRequest.toTypedArray())
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PcpWebViewScreen(
  onOpenFileChooser: (ValueCallback<Array<Uri>>, Intent) -> Unit
) {
  var webViewRef by remember { mutableStateOf<WebView?>(null) }

  // Handle system back button to close modals or history
  BackHandler(enabled = true) {
    webViewRef?.let { wv ->
      wv.evaluateJavascript(
        "(function() { " +
          "const activeModal = document.querySelector('.modal-overlay.active'); " +
          "if (activeModal) { activeModal.classList.remove('active'); return true; } " +
          "const searchDropdown = document.getElementById('search-dropdown'); " +
          "if (searchDropdown && searchDropdown.classList.contains('visible')) { searchDropdown.classList.remove('visible'); return true; } " +
          "const activeScreen = document.querySelector('.sub-screen.active'); " +
          "if (activeScreen) { switchScreen('screen-map'); return true; } " +
          "return false; " +
        "})()"
      ) { result ->
        if (result == "false") {
          if (wv.canGoBack()) {
            wv.goBack()
          }
        }
      }
    }
  }

  AndroidView(
    modifier = Modifier.fillMaxSize(),
    factory = { context ->
      WebView(context).apply {
        webViewRef = this

        settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          databaseEnabled = true
          allowFileAccess = true
          allowContentAccess = true
          setGeolocationEnabled(true)
          cacheMode = WebSettings.LOAD_DEFAULT
          useWideViewPort = true
          loadWithOverviewMode = true
          displayZoomControls = false
          builtInZoomControls = false
        }

        webViewClient = object : WebViewClient() {
          override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url?.toString() ?: return false
            if (url.startsWith("tel:") || url.startsWith("mailto:") || url.startsWith("geo:") || url.contains("maps.google.com")) {
              try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                context.startActivity(intent)
                return true
              } catch (e: Exception) {
                return false
              }
            }
            return false
          }
        }

        webChromeClient = object : WebChromeClient() {
          override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: GeolocationPermissions.Callback?
          ) {
            // Automatically grant location permissions to local assets
            callback?.invoke(origin, true, false)
          }

          override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?
          ): Boolean {
            filePathCallback?.let { cb ->
              val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
              }
              onOpenFileChooser(cb, intent)
              return true
            }
            return false
          }
        }

        loadUrl("file:///android_asset/www/index.html")
      }
    },
    update = { webView ->
      webViewRef = webView
    }
  )
}
