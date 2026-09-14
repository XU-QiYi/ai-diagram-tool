# 社区闲置工具共享租借平台 - 用例图

```mermaid
graph LR
    %% 定义参与者
    User((普通用户))
    Admin((管理员))
    System((系统))
    
    %% 定义用例
    Register[用户注册]
    Login[用户登录]
    Browse[浏览工具]
    Search[搜索工具]
    Publish[发布工具]
    EditTool[编辑工具信息]
    Rent[申请租借]
    Confirm[确认租借]
    Return[归还工具]
    Review[评价工具]
    Message[查看消息]
    Profile[管理个人信息]
    
    UserManage[用户管理]
    ToolManage[工具审核]
    Statistics[数据统计]
    SystemConfig[系统配置]
    
    Notify[发送通知]
    Payment[处理支付]
    
    %% 普通用户关系
    User --> Register
    User --> Login
    User --> Browse
    User --> Search
    User --> Publish
    User --> EditTool
    User --> Rent
    User --> Return
    User --> Review
    User --> Message
    User --> Profile
    
    %% 管理员关系
    Admin --> Login
    Admin --> UserManage
    Admin --> ToolManage
    Admin --> Statistics
    Admin --> SystemConfig
    Admin --> Browse
    
    %% 系统关系
    System --> Notify
    System --> Payment
    
    %% 包含关系
    Rent -.->|include| Confirm
    Publish -.->|include| Login
    Rent -.->|include| Login
    Review -.->|include| Return
    
    %% 扩展关系
    Browse -.->|extend| Search
    Rent -.->|extend| Payment
    
    %% 样式
    classDef actor fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef usecase fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef system fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    
    class User,Admin actor
    class System system
    class Register,Login,Browse,Search,Publish,EditTool,Rent,Confirm,Return,Review,Message,Profile,UserManage,ToolManage,Statistics,SystemConfig usecase
    class Notify,Payment system
```

## 用例说明

### 普通用户用例
- **用户注册**: 新用户创建账号
- **用户登录**: 用户身份验证
- **浏览工具**: 查看平台上的工具列表
- **搜索工具**: 根据关键词、类别搜索工具
- **发布工具**: 用户发布闲置工具供他人租借
- **编辑工具信息**: 修改已发布工具的信息
- **申请租借**: 用户申请租借某个工具
- **确认租借**: 工具所有者确认租借请求
- **归还工具**: 租借结束后归还工具
- **评价工具**: 对租借过的工具进行评价
- **查看消息**: 查看系统通知和用户消息
- **管理个人信息**: 修改个人资料和设置

### 管理员用例
- **用户管理**: 管理平台用户，处理违规行为
- **工具审核**: 审核用户发布的工具信息
- **数据统计**: 查看平台运营数据和统计报表
- **系统配置**: 配置平台参数和规则

### 系统用例
- **发送通知**: 自动发送各类通知消息
- **处理支付**: 处理租借交易的支付流程

## 关系说明
- **实线箭头**: 参与者与用例的关联关系
- **虚线箭头 (include)**: 包含关系，基础用例必须执行
- **虚线箭头 (extend)**: 扩展关系，可选执行
