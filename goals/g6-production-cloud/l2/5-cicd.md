---
title: CI/CD and evaluation gates
---

Recap (G6.5 L1): every change that can move the answers (code, prompt, model, retrieval settings, data) is versioned and passes an evaluation gate before release. Here you build that pipeline for the capstone with GitHub Actions, a JUnit (Java's standard test framework) evaluation test, MLflow, and Docker images (container images, built and run with the Docker tool).

## What gets versioned, and where

| Artifact | Versioned in | Version ID |
|---|---|---|
| App code | Git | commit SHA (the hash that identifies a commit) |
| System prompt | a file in Git, or the MLflow Prompt Registry | commit SHA, or prompt version |
| Chat and embedding model IDs, top-k, threshold | `application.yml` in Git | commit SHA |
| Evaluation questions | Git when small; DVC when large | commit SHA |
| Fine-tuned model (G4) | MLflow Model Registry | model version, plus an alias such as `champion` |
| Container image | Amazon ECR (AWS's container registry) | tag = commit SHA |

Tagging the image with the commit SHA links every running container to the exact code, prompt, and settings inside it. Rolling back is then redeploying the previous tag.

**Prompts as files.** A prompt kept in code changes silently inside a diff; kept as its own file, it gets its own history and review. `defaultSystem` also accepts a Spring `Resource`, so in G6.2's `assistantClient` bean, add the parameter `@Value("classpath:prompts/assistant-system.st") Resource systemPrompt` and replace the text block with `.defaultSystem(systemPrompt)`.

## The offline evaluation as a JUnit test

An **evaluation gate** for a Java app can be an ordinary test that fails the build when quality drops. Spring AI provides **evaluators**, classes that ask a model to judge an answer (an LLM judge, G5.6):

- `RelevancyEvaluator` — is the answer relevant to the question, given the retrieved context?
- `FactCheckingEvaluator` — is a claim supported by the given context? It catches hallucinations, claims the model made up (G3.2).

Each takes an `EvaluationRequest(question, retrievedDocuments, answer)` and returns an `EvaluationResponse` whose `isPass()` is the verdict. The gate runs every question in a saved set, one per line in `src/test/resources/eval/questions.txt`, and requires a minimum pass rate. `@SpringBootTest` starts the whole app inside the test:

```java
@SpringBootTest(properties = {
        "assistant.manuals=classpath*:manuals/*.pdf",
        "spring.ai.mcp.client.enabled=false"
})
@Tag("eval")
class AnswerRelevancyEvaluationTest {

    private static final double MIN_PASS_RATE = 0.85;

    @Autowired
    @Qualifier("assistantClient")
    ChatClient assistantClient;

    @Autowired
    ChatClient.Builder judgeBuilder;

    @Autowired
    ManualIngestion ingestion;

    @Test
    void answersStayRelevantToTheirContext() throws IOException {
        ingestion.reindexAll();
        List<String> questions = Files.readAllLines(Path.of("src/test/resources/eval/questions.txt"));
        RelevancyEvaluator judge = new RelevancyEvaluator(judgeBuilder);

        long relevant = questions.stream().filter(question -> isRelevant(question, judge)).count();
        double passRate = (double) relevant / questions.size();

        assertThat(passRate).as("share of relevant answers").isGreaterThanOrEqualTo(MIN_PASS_RATE);
    }

    private boolean isRelevant(String question, RelevancyEvaluator judge) {
        ChatResponse response = assistantClient.prompt()
                .user(question)
                .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, "eval:" + UUID.randomUUID()))
                .toolContext(Map.of("customerId", 0L))
                .call()
                .chatResponse();
        EvaluationRequest request = new EvaluationRequest(question,
                response.getMetadata().get(QuestionAnswerAdvisor.RETRIEVED_DOCUMENTS),
                response.getResult().getOutput().getText());
        return judge.evaluate(request).isPass();
    }
}
```

The choices in it:

- **A fresh conversation ID per question** keeps one question's history out of the next one's prompt.
- **Test manuals on the classpath** make the run repeatable: the same documents, the same questions, every time.
- **The threshold** starts at the pass rate the current production version reaches on the same set, so the gate blocks regressions rather than demanding perfection. Each question users reported as badly answered (G6.6) joins the file, so the set grows with every failure found.
- **`@Tag("eval")`** keeps the slow, paid test out of the normal build: `./mvnw verify -DexcludedGroups=eval` skips it, and `./mvnw test -Dgroups=eval` runs only it. `groups` and `excludedGroups` are the JUnit 5 tag filters of Maven Surefire, Maven's test-running plugin.

An LLM judge is itself a model and can be wrong; checking it against human labels is G5.6 L3. For Python models, `mlflow.genai.evaluate(data=…, predict_fn=…, scorers=[Correctness(), Guidelines(…)])` plays the same role, with MLflow's built-in judge scorers.

## The GitHub Actions pipeline

**GitHub Actions** runs **workflows**, YAML files in `.github/workflows/`, on events such as a pull request (a proposed change, reviewed before it is merged into the main branch) or a push. A workflow has **jobs**, which run on fresh virtual machines (`runs-on`) in parallel unless one `needs` another; each job is a list of **steps**, each a shell command (`run`) or a reusable **action** (`uses`).

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '25'
          cache: maven
      - run: ./mvnw -B verify -DexcludedGroups=eval

  evaluate:
    needs: test
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg18-trixie
        env:
          POSTGRES_USER: assistant
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: assistant
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '25'
          cache: maven
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::111122223333:role/github-eval
          aws-region: us-east-1
      - run: ./mvnw -B test -Dgroups=eval
        env:
          DB_PASSWORD: ci

  image:
    if: github.ref == 'refs/heads/main'
    needs: evaluate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '25'
          cache: maven
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::111122223333:role/github-deploy
          aws-region: us-east-1
      - id: ecr
        uses: aws-actions/amazon-ecr-login@v2
      - run: |
          IMAGE=${{ steps.ecr.outputs.registry }}/docs-assistant:${{ github.sha }}
          ./mvnw -B spring-boot:build-image -DskipTests -Dspring-boot.build-image.imageName=$IMAGE
          docker push $IMAGE
```

How it fits together:

- **`test`** runs the unit tests on every pull request. `setup-java` installs Java 25 (the Eclipse Temurin build) and caches Maven's downloads; `-B` runs Maven in batch mode, with no interactive output.
- **`evaluate`** runs only after `test` passes. Its `services` block starts a PostgreSQL container with pgvector next to the job, and waits until `pg_isready` reports it up; the app reaches it on `localhost:5432`. The eval test then loads the test manuals and runs the gate against real Bedrock models. A failed gate fails the pull request's check; making that check required in the branch's protection rules blocks the merge.
- **AWS access without stored keys.** `id-token: write` lets the job request an OpenID Connect token from GitHub, a signed statement of which repository and branch the job runs for; `configure-aws-credentials` trades it for short-lived credentials of the IAM role `github-eval`, whose trust policy (the role's rule on who may assume it) should accept tokens from this repository only. That role gets only the Bedrock permissions from G6.1.
- **`image`** runs only on `main`, after the gate. `spring-boot:build-image` builds an OCI image (the standard container image format that Docker runs) with Cloud Native Buildpacks (tools that turn source code into an image), with no Dockerfile (the script of steps that builds an image) to maintain, and tags it with the commit SHA; `docker push` sends it to Amazon ECR, AWS's container registry, where deployment (ECS or EKS) picks it up.

## MLflow: models, prompts, and data

**MLflow Model Registry** keeps each version of a model you trained, such as the LoRA ticket classifier from G4, with the run that produced it. An **alias** is a movable name for one version: deployment always loads `@champion`, and promoting a new version means moving the alias, not changing the app.

```python
import mlflow
from mlflow import MlflowClient

mlflow.set_tracking_uri("http://mlflow.internal:5000")

version = mlflow.register_model(model_uri=model_info.model_uri, name="ticket-classifier")

client = MlflowClient()
client.set_registered_model_alias("ticket-classifier", "champion", version.version)

champion = mlflow.pyfunc.load_model("models:/ticket-classifier@champion")
```

`model_info` is what `log_model` returned in the training run. The tracking URI is the MLflow server's address, and `pyfunc` is MLflow's generic Python model format, which loads any registered model the same way. Registering a name that exists adds version 2, 3, and so on. Aliases replace MLflow's older **stages** (Staging, Production), which are deprecated. The same promotion done by hand in CI is the gate for a model change: evaluate the candidate version, and move `champion` only if it beats the current one.

**MLflow Prompt Registry** does the same for prompts, with a commit message per version and `{{variable}}` placeholders:

```python
prompt = mlflow.genai.register_prompt(
    name="assistant-system",
    template="You answer questions about {{product}} manuals. If the answer is not in the context, say that you don't know.",
    commit_message="Refuse when the context is missing",
)

loaded = mlflow.genai.load_prompt("prompts:/assistant-system@latest")
system_text = loaded.format(product="router")
```

It suits Python apps; the Java capstone keeps prompts as files in Git, which gives the same history with no extra service.

**DVC** (Data Version Control) versions large files, such as an evaluation set of thousands of questions, beside Git: Git stores a small pointer file, and the data itself goes to a remote such as S3.

```bash
dvc remote add -d storage s3://assistant-datasets/dvcstore
dvc add data/eval/questions.jsonl
git add data/eval/questions.jsonl.dvc data/eval/.gitignore
git commit -m "Add evaluation set v2"
dvc push
```

Checking out an old commit and running `dvc pull` restores the matching data, so an old evaluation score can be reproduced.

Sources: [Spring AI — ChatClient defaults (`defaultSystem(Resource)`)](https://docs.spring.io/spring-ai/reference/api/chatclient.html) · [Spring AI — evaluation testing](https://docs.spring.io/spring-ai/reference/api/testing.html) · [QuestionAnswerAdvisor evaluation in Spring AI's own tests](https://github.com/spring-projects/spring-ai/blob/v2.0.1/spring-ai-integration-tests/src/test/java/org/springframework/ai/integration/tests/client/advisor/QuestionAnswerAdvisorIT.java) · [Maven Surefire — `groups` and `excludedGroups`](https://maven.apache.org/surefire/maven-surefire-plugin/test-mojo.html) · [MLflow GenAI evaluation](https://mlflow.org/docs/latest/genai/eval-monitor/) · [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) · [PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) · [OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) · [actions/checkout](https://github.com/actions/checkout) · [actions/setup-java](https://github.com/actions/setup-java) · [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) · [aws-actions/amazon-ecr-login](https://github.com/aws-actions/amazon-ecr-login) · [Spring Boot — build-image](https://docs.spring.io/spring-boot/maven-plugin/build-image.html) · [MLflow Model Registry workflow (aliases, deprecated stages)](https://mlflow.org/docs/latest/ml/model-registry/workflow/) · [MLflow Prompt Registry](https://mlflow.org/docs/latest/genai/prompt-registry/) · [DVC — data versioning](https://dvc.org/doc/start/data-management/data-versioning)
