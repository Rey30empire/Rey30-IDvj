//! Request identity for the headless Rey30 IDvj client. This module does not
//! persist an installation identifier or send analytics requests.

pub fn user_agent(version: &str) -> String {
    crate::core::agent::request_headers::agent_user_agent(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_names_the_agent() {
        let ua = user_agent("0.8.4-37");
        assert!(ua.starts_with("Rey30-IDvj-Agent/0.8.4-37 ("), "{ua}");
    }
}
