plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.example.zcode_mobile"
    buildToolsVersion = "36.1.0"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.example.zcode_mobile"
        minSdk = 24
        targetSdk = 36
        versionCode = System.getenv("ZCODE_ANDROID_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = System.getenv("ZCODE_ANDROID_VERSION_NAME") ?: "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
    }

    signingConfigs {
        create("releaseCi") {
            val keyPath = System.getenv("ZCODE_ANDROID_KEYSTORE")
            if (keyPath != null) {
                storeFile = file(keyPath)
                storePassword = System.getenv("ZCODE_ANDROID_STORE_PASSWORD")
                keyAlias = System.getenv("ZCODE_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ZCODE_ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            signingConfig = signingConfigs.getByName("releaseCi")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
