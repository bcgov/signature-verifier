# Build upstream EU DSS webapp WAR with Portage/Notarius truststore (no custom Java)
FROM docker.io/library/maven:3.9.16-eclipse-temurin-26 AS build

ARG DSS_DEMO_VERSION=6.5.1
ARG DSS_DEMO_COMMIT=3c79488771671220542267129a9419586832ad55

WORKDIR /src
RUN git clone --depth 1 --branch "${DSS_DEMO_VERSION}" https://github.com/esig/dss-demonstrations.git . \
    && test "$(git rev-parse HEAD)" = "${DSS_DEMO_COMMIT}"

COPY certs/notarius-root-2014.pem certs/notarius-root-2021.pem /tmp/certs/
COPY dss.properties dss-demo-webapp/src/main/resources/dss.properties

RUN keytool -importcert -noprompt -alias notarius-root-2014 \
      -file /tmp/certs/notarius-root-2014.pem \
      -keystore dss-demo-webapp/src/main/resources/notarius-truststore.p12 \
      -storetype PKCS12 -storepass changeit \
    && keytool -importcert -noprompt -alias notarius-root-2021 \
      -file /tmp/certs/notarius-root-2021.pem \
      -keystore dss-demo-webapp/src/main/resources/notarius-truststore.p12 \
      -storetype PKCS12 -storepass changeit

RUN mvn package -pl dss-demo-webapp -P quick -Dmdep.skip=true -DskipTests -B -q

# Runtime: pre-exploded ROOT webapp so Tomcat runs under readOnlyRootFilesystem + non-root SCC
FROM docker.io/library/tomcat:11.0.27-jdk25-temurin

COPY --from=build /src/dss-demo-webapp/target/dss-demo-webapp-*.war /tmp/ROOT.war
RUN mkdir -p /usr/local/tomcat/webapps/ROOT /usr/local/tomcat/conf/Catalina \
    && cd /usr/local/tomcat/webapps/ROOT \
    && jar xf /tmp/ROOT.war \
    && rm -f /tmp/ROOT.war \
    && chgrp -R 0 /usr/local/tomcat \
    && chmod -R g=u /usr/local/tomcat

EXPOSE 8080
USER 10001
