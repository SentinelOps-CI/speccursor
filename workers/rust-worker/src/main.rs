use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use serde_json::json;
use speccursor_rust_worker::{UpgradeRequest, UpgradeWorker, WorkerConfig};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let config = WorkerConfig {
        max_execution_time: 300,
        memory_limit: 1024 * 1024 * 1024, // 1GB
        sandbox_enabled: true,
        log_level: "info".to_string(),
    };

    let worker = UpgradeWorker::new(Some(config));

    println!("🚀 SpecCursor Rust Worker starting on port 8080...");

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(worker.clone()))
            .route("/health", web::get().to(health_check))
            .route("/upgrade", web::post().to(process_upgrade))
            .route("/metrics", web::get().to(metrics))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}

async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(json!({
        "status": "healthy",
        "service": "rust-worker",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn process_upgrade(
    worker: web::Data<UpgradeWorker>,
    request: web::Json<UpgradeRequest>,
) -> impl Responder {
    match worker.process_upgrade(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => HttpResponse::BadRequest().json(json!({
            "error": e.to_string(),
            "error_type": format!("{:?}", e.error_type)
        })),
    }
}

async fn metrics() -> impl Responder {
    HttpResponse::Ok().json(json!({
        "worker": {
            "status": "running",
            "uptime": "0s",
            "processed_jobs": 0,
            "failed_jobs": 0
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test;

    #[actix_web::test]
    async fn test_health_check() {
        let app =
            test::init_service(App::new().route("/health", web::get().to(health_check))).await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
    }

    #[actix_web::test]
    async fn test_process_upgrade() {
        let config = WorkerConfig {
            max_execution_time: 300,
            memory_limit: 1024 * 1024 * 1024,
            sandbox_enabled: true,
            log_level: "info".to_string(),
        };

        let worker = UpgradeWorker::new(Some(config));
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(worker))
                .route("/upgrade", web::post().to(process_upgrade)),
        )
        .await;

        let request = UpgradeRequest {
            repository: "test/repo".to_string(),
            ecosystem: "npm".to_string(),
            package_name: "lodash".to_string(),
            current_version: "1.0.0".to_string(),
            target_version: "2.0.0".to_string(),
            metadata: HashMap::new(),
        };

        let req = test::TestRequest::post()
            .uri("/upgrade")
            .set_json(&request)
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[actix_web::test]
    async fn test_metrics() {
        let app = test::init_service(App::new().route("/metrics", web::get().to(metrics))).await;

        let req = test::TestRequest::get().uri("/metrics").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
    }
}
