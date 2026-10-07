plugins {
    id("com.android.application")
    id("com.chaquo.python")
}

android { namespace = "com.origin.osd"; compileSdk = 35
    defaultConfig { applicationId = "com.origin.osd"; minSdk = 29; targetSdk = 35; versionCode = 12000; versionName = "1.20.0"; ndk { abiFilters += listOf("arm64-v8a", "x86_64") } }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("debug") } }
}

chaquopy { defaultConfig { version = "3.13" } }

dependencies { implementation("androidx.appcompat:appcompat:1.7.1"); implementation("dev.ffmpegkit-maintained:ffmpeg-kit-full:8.1.7") }

configurations.all {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains.kotlin") {
            useVersion("1.8.22")
        }
    }
}
