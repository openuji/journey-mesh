/** Injected into the invoked build; wrapper filenames alone are not observed tool versions. */
export const gradleObservations = String.raw`
import groovy.json.JsonOutput
import org.gradle.api.tasks.compile.JavaCompile

def output = new File(System.getenv('JOURNEY_GRADLE_OBSERVATIONS'))
output.mkdirs()
gradle.settingsEvaluated {
  new File(output, 'runtime.json').text = JsonOutput.toJson([
    gradle: gradle.gradleVersion,
    jvm: [version: System.getProperty('java.version'), vendor: System.getProperty('java.vendor')]
  ])
}
gradle.allprojects { project ->
  project.tasks.withType(JavaCompile).configureEach { task ->
    task.doFirst {
      def compiler = task.javaCompiler.orNull
      def observation = [task: task.path, project: project.name, status: compiler ? 'observed' : 'unknown']
      if (compiler) {
        def metadata = compiler.metadata
        observation.java = [major: metadata.languageVersion.asInt(), version: metadata.javaRuntimeVersion, vendor: metadata.vendor.toString()]
      }
      new File(output, UUID.randomUUID().toString() + '.json').text = JsonOutput.toJson(observation)
    }
  }
}
`;
