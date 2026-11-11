using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Immersa.Core
{
    // One place for the JSON rules shared with the web app: camelCase names, absent optional fields are not written.
    public static class Json
    {
        public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy() },
            NullValueHandling = NullValueHandling.Ignore,
            MissingMemberHandling = MissingMemberHandling.Ignore,
        };

        public static T Parse<T>(string json) => JsonConvert.DeserializeObject<T>(json, Settings);
        public static string Write(object value) => JsonConvert.SerializeObject(value, Settings);
    }
}
