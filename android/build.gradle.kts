plugins {
    id("com.android.application") apply false
    id("com.android.library") apply false
    id("org.jetbrains.kotlin.android") apply false
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}

subprojects {
    project.evaluationDependsOn(":app")

    tasks.matching { it.name.contains("verify", ignoreCase = true) && it.name.contains("Resources", ignoreCase = true) }.configureEach {
        enabled = false
    }

    // Apply compileSdk = 36 only to plugin subprojects, skipping :app
    if (project.path != ":app") {
        val configureSdk = {
            val android = project.extensions.findByName("android")
            if (android is com.android.build.gradle.BaseExtension) {
                android.compileSdkVersion(36)
            }
        }

        if (project.state.executed) {
            configureSdk()
        } else {
            project.afterEvaluate { configureSdk() }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}